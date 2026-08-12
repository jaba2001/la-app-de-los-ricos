// Sube research/out/kb_docs.json y kb_chunks.json a Supabase.
//
// POR QUÉ EXISTE, SI ingest_filings.mjs YA SUBE:
// ingest_filings.mjs sube al final de una ingesta, así que "subir lo que ya tengo" obligaba
// a volver a descargar ~120 10-K de EDGAR — media hora, y a merced de que SEC no nos limite.
// Los JSON del disco YA son el resultado bueno (parser afinado, regresión en verde), así que
// subirlos es una operación aparte y trivial. Esto además la hace repetible: si un lote falla,
// se relanza sin re-ingestar nada.
//
// Es idempotente: upsert por `id` (misma clave que genera la ingesta), así que ejecutarlo dos
// veces deja la tabla igual, no duplicada.
//
//   SUPABASE_SERVICE_KEY=... node research/upload_kb.mjs
//   SUPABASE_SERVICE_KEY=... node research/upload_kb.mjs --dry-run   (valida sin escribir)
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const DRY = process.argv.includes("--dry-run");

const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// La anon key no puede escribir en kb_* (RLS), así que fallaría fila a fila con un 401 poco
// claro después de haber subido nada. Mejor decirlo aquí.
if (!DRY && !SB_KEY) {
  console.error(
    "\n  Falta SUPABASE_SERVICE_KEY.\n" +
    "  Supabase → Project Settings → API → 'service_role' (secret).\n" +
    "  Uso:  SUPABASE_SERVICE_KEY=eyJ... node research/upload_kb.mjs\n"
  );
  process.exit(1);
}

function load(name) {
  const p = join(OUT, name);
  if (!existsSync(p)) {
    console.error(`  No existe ${p} — ejecuta antes: node research/ingest_filings.mjs`);
    process.exit(1);
  }
  const rows = JSON.parse(readFileSync(p, "utf8"));
  if (!Array.isArray(rows) || !rows.length) {
    console.error(`  ${name} está vacío o no es un array.`);
    process.exit(1);
  }
  return rows;
}

const docs = load("kb_docs.json");
const chunks = load("kb_chunks.json");

// Comprobación previa: un id duplicado dentro del MISMO lote hace que PostgREST rechace el
// batch entero ("ON CONFLICT DO UPDATE command cannot affect row a second time"), y el error
// no dice cuál es. Vale más detectarlo aquí que perseguirlo en un 400.
function dupes(rows, label) {
  const seen = new Set(), bad = new Set();
  for (const r of rows) { if (seen.has(r.id)) bad.add(r.id); seen.add(r.id); }
  if (bad.size) {
    console.error(`  ${label}: ${bad.size} id(s) duplicados, p.ej. ${[...bad].slice(0, 3).join(", ")}`);
    process.exit(1);
  }
}
dupes(docs, "kb_docs");
dupes(chunks, "kb_chunks");

const tickers = new Set(chunks.map((c) => c.ticker));
console.log(`\n  kb_docs   ${docs.length} filas`);
console.log(`  kb_chunks ${chunks.length} chunks · ${tickers.size} empresas`);

if (DRY) {
  console.log("\n  --dry-run: JSON válido, sin duplicados. No se ha escrito nada.\n");
  process.exit(0);
}

/** Upsert por lotes: un body de 7 MB de una vez lo rechaza PostgREST. */
async function upsert(table, rows, batch = 500) {
  let ok = 0;
  const failed = [];
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const resp = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(slice),
    });
    if (resp.ok) {
      ok += slice.length;
      process.stdout.write(`\r  ${table}: ${ok}/${rows.length}`);
    } else {
      failed.push(`lote ${i}: ${resp.status} ${(await resp.text().catch(() => "")).slice(0, 200)}`);
    }
  }
  process.stdout.write("\n");
  for (const f of failed) console.error(`  ✗ ${table} ${f}`);
  return { ok, total: rows.length };
}

const r1 = await upsert("kb_docs", docs);
const r2 = await upsert("kb_chunks", chunks);

const allOk = r1.ok === r1.total && r2.ok === r2.total;
console.log(
  `\n  ${allOk ? "✓" : "✗"} kb_docs ${r1.ok}/${r1.total} · kb_chunks ${r2.ok}/${r2.total}\n`
);
// Salir distinto de 0 si faltó algo: así un fallo parcial no se lee como éxito de un vistazo.
process.exit(allOk ? 0 : 1);
