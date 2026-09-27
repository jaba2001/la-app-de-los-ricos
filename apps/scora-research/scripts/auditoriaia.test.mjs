// El registro de auditoría de la IA lo escribe el SERVIDOR (AUDIT_REPORT A-4).
//   PGHOST=127.0.0.1 PGPORT=5544 node --experimental-strip-types --no-warnings scripts/auditoriaia.test.mjs
//
// Antes lo escribía el navegador: podía omitirse o falsearse, y se PERDÍA EN SILENCIO cuando
// la respuesta tenía una violación direccional, porque metía texto en `violations`, que es
// numeric[]. Esta prueba fija las tres cosas: la fila la pone el servidor con el usuario que
// él decide, sobrevive a una violación direccional, y el navegador ya no puede insertar.
//
// La parte pura (validación de metadatos, reparto de violaciones, política) corre siempre;
// la de Postgres se salta sin base.
import pg from "pg";
import { leerMetaAuditoria, evaluarGrounding, bloqueDeDatos } from "../lib/server/auditoriaIA.js";
import { construir, RechazoPolitica } from "../lib/server/data/query.ts";

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};

// ── Sin base ────────────────────────────────────────────────────────────────────────
check("sin scora_audit → null (llamada sin auditar)", leerMetaAuditoria(undefined), null);
check("metadatos válidos", leerMetaAuditoria({ module: "stock-thesis", ticker: "AAPL", sources: ["fmp"], dataBlockEsPrompt: true }),
  { module: "stock-thesis", ticker: "AAPL", sources: ["fmp"], dataBlockEsPrompt: true, dataBlockEnPrompt: null, dataBlock: null });
check("módulo con caracteres raros → error", "error" in leerMetaAuditoria({ module: "x'; drop" }), true);
check("sources que no es lista → error", "error" in leerMetaAuditoria({ module: "m", sources: "fmp" }), true);

// Revisión 27-09: tres metadatos que el cliente manda de verdad y que el servidor rechazaba con
// 400, llevándose por delante el análisis entero.
//  · /stock/aapl → useParams da "aapl" y varias pantallas lo pasan tal cual.
check("ticker en minúsculas → se normaliza, no se rechaza", leerMetaAuditoria({ module: "m", ticker: " aapl " }).ticker, "AAPL");
check("ticker con caracteres de URL → error", "error" in leerMetaAuditoria({ module: "m", ticker: "AAPL&x=1" }), true);
//  · las fuentes de DueDiligence son "10-K Item 1A. Risk Factors…" y StockNews junta hasta 20+.
{
  const m = leerMetaAuditoria({ module: "m", sources: [...Array(25)].map((_, i) => `fuente ${i} ` + "x".repeat(200)) });
  check("más de 20 fuentes → se recortan a 20", m.sources?.length, 20);
  check("una fuente larga → se trunca a 120", m.sources?.[0].length, 120);
  check("entradas que no son texto → se descartan", leerMetaAuditoria({ module: "m", sources: ["fmp", 3, null] }).sources, ["fmp"]);
}
//  · el bloque dentro del prompt viaja como posición, no como texto duplicado.
{
  const prompt = "REGLAS 12 · DATA: price $184.20 · FIN";
  const ini = prompt.indexOf("DATA"), largo = "DATA: price $184.20".length;
  const m = leerMetaAuditoria({ module: "m", dataBlockEnPrompt: [ini, largo] });
  check("dataBlockEnPrompt → el servidor recorta el bloque del prompt", bloqueDeDatos(m, prompt), "DATA: price $184.20");
  check("fuera de rango → el prompt entero, no un bloque vacío", bloqueDeDatos(leerMetaAuditoria({ module: "m", dataBlockEnPrompt: [30, 999] }), prompt), prompt);
  check("posición con negativos → error", "error" in leerMetaAuditoria({ module: "m", dataBlockEnPrompt: [-1, 3] }), true);
  check("dataBlockEsPrompt → el prompt", bloqueDeDatos(leerMetaAuditoria({ module: "m", dataBlockEsPrompt: true }), prompt), prompt);
}

const DATOS = "DATA: price $184.20 · target $165";
const MENTIRA = "The $165 target sits above the $184.20 price.";   // cifras reales, afirmación falsa
{
  const ev = evaluarGrounding(MENTIRA, DATOS);
  check("violación direccional → no fundamentado", ev.grounded, false);
  check("a la base solo van los números (numeric[])", ev.numericas, []);
  check("a la interfaz va también la descripción", ev.violaciones.length, 1);
}
{
  const ev = evaluarGrounding("The price is $999.", DATOS);
  check("cifra que no está en los datos → marcada", ev.numericas, [999]);
}

// El navegador ya no puede escribir su propio registro.
{
  let rechazo = null;
  try { construir({ table: "ai_audit_log", op: "insert", rows: [{ module: "x", grounded: true }] }, "ana", { ai_audit_log: new Set(["user_id", "module", "grounded"]) }); }
  catch (e) { rechazo = e instanceof RechazoPolitica; }
  check("insert en ai_audit_log desde el navegador → rechazado por la política", rechazo, true);
}

// ── Con base ────────────────────────────────────────────────────────────────────────
const host = process.env.PGHOST || "/tmp/scpg";
const port = Number(process.env.PGPORT || 5544);
const probe = new pg.Client({ host, port, user: "postgres", database: "scora" });
try { await probe.connect(); await probe.end(); }
catch {
  console.log(`\n○ auditoriaIA: parte con base SALTADA — no hay Postgres en ${host}:${port}`);
  console.log(bad ? `\n✗ auditoriaIA: ${bad} fallo(s) de ${total}` : `\n✓ auditoriaIA: ${total} comprobaciones OK (sin base)`);
  process.exit(bad ? 1 : 0);
}
process.env.PGHOST = host; process.env.PGPORT = String(port);
process.env.PGUSER = "postgres"; process.env.PGDATABASE = "scora";
const { pool } = await import("../lib/server/data/pool.ts");
const { anotarRespuesta } = await import("../lib/server/auditoriaIA.js");
const db = pool();
await db.query("truncate ai_audit_log");

const respuestaDe = (texto) => JSON.stringify({ content: [{ type: "text", text: texto }],
  usage: { input_tokens: 1000, output_tokens: 200 } });
const messages = [{ role: "user", content: DATOS }];
const meta = leerMetaAuditoria({ module: "stock-thesis", ticker: "AAPL", sources: ["fmp"], dataBlockEsPrompt: true });

{
  const out = JSON.parse(await anotarRespuesta({ textoRespuesta: respuestaDe(MENTIRA), ok: true,
    userId: "uid-del-token", model: "claude-haiku-4-5", messages, meta }));
  check("la respuesta vuelve con scora_audit", out.scora_audit?.grounded, false);
  check("y dice que quedó registrada", out.scora_audit?.registrado, true);
  const { rows } = await db.query("select user_id, module, ticker, grounded, violations, est_cost_usd from ai_audit_log");
  check("hay UNA fila, también con violación direccional (antes se perdía)", rows.length, 1);
  check("el usuario es el del token, no el que diga el navegador", rows[0]?.user_id, "uid-del-token");
  check("fila: módulo y ticker", [rows[0]?.module, rows[0]?.ticker], ["stock-thesis", "AAPL"]);
  check("fila: grounded = false", rows[0]?.grounded, false);
  check("fila: coste estimado (1000 in + 200 out a 1/5 $ por millón)", Number(rows[0]?.est_cost_usd), 0.002);
}
{
  await db.query("truncate ai_audit_log");
  const original = respuestaDe("hola");
  check("sin metadatos, la respuesta no se toca", await anotarRespuesta({ textoRespuesta: original, ok: true,
    userId: "u", model: "m", messages, meta: null }), original);
  check("una respuesta de error no se registra", await anotarRespuesta({ textoRespuesta: '{"error":{}}', ok: false,
    userId: "u", model: "m", messages, meta }), '{"error":{}}');
  check("y no deja filas", (await db.query("select count(*)::int n from ai_audit_log")).rows[0].n, 0);
}

await db.query("truncate ai_audit_log");
await db.end();
console.log(bad ? `\n✗ auditoriaIA: ${bad} fallo(s) de ${total}` : `\n✓ auditoriaIA: ${total} comprobaciones OK contra Postgres real`);
process.exit(bad ? 1 : 0);
