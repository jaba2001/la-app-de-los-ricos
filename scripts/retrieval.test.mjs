// ─────────────────────────────────────────────────────────────────────────────
// RETRIEVAL TESTS — the filing-grounding path (Fase 8).
//
// These guard the fix for a bug that was invisible from the outside: the grounded thesis
// reported itself as "✓ grounded" while citing the BOILERPLATE PREAMBLE of a 10-K's Risk
// Factors section instead of any actual risk. The grounding gate was fine — it verifies
// numbers, and risks are prose — so nothing failed. What failed was what the gate was fed.
//
// Two pure functions carry that fix, and both are tested here:
//   · chunkText        (research/ingest_filings.mjs) — split a section without losing text
//   · renderDocChunks  (lib/filingRender.ts)         — budget the prompt without re-truncating
//
// Headless, deterministic, no credentials, no network.
// Run: node --experimental-strip-types --no-warnings scripts/retrieval.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { renderDocChunks, DEFAULT_FILING_QUERY } from "../lib/filingRender.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const fails = [];
function ok(cond, msg) { if (cond) passed++; else { failed++; fails.push(msg); } }

// ── chunkText ────────────────────────────────────────────────────────────────
// Lives inside ingest_filings.mjs, which runs a live SEC ingest on import, so it can't be
// imported here. Extract the function source and evaluate just that — mechanical, and a
// drift in the signature shows up as a syntax error rather than a silent skip.
const ingestSrc = readFileSync(join(ROOT, "research", "ingest_filings.mjs"), "utf8");
const fnSrc = ingestSrc.match(/function chunkText[\s\S]*?\n}/);
ok(!!fnSrc, "chunkText sigue existiendo en research/ingest_filings.mjs");
let chunkText;
if (fnSrc) {
  const CHUNK_CHARS = 900, CHUNK_OVERLAP = 120;
  chunkText = new Function("CHUNK_CHARS", "CHUNK_OVERLAP", `${fnSrc[0]}; return chunkText;`)(CHUNK_CHARS, CHUNK_OVERLAP);
}

if (chunkText) {
  ok(chunkText("hola mundo").length === 1, "texto corto → un solo chunk");
  ok(chunkText("").length === 0, "texto vacío → sin chunks");
  ok(chunkText("   ").length === 0, "solo espacios → sin chunks");

  // Una sección larga y realista: debe trocearse sin perder una sola frase. Esa es la
  // propiedad que importa — un riesgo que se pierda entre dos chunks es un riesgo que el
  // modelo nunca verá.
  const sentences = Array.from({ length: 400 }, (_, i) => `Esta es la frase numero ${i} del apartado de riesgos.`);
  const long = sentences.join(" ");
  const cs = chunkText(long);
  ok(cs.length > 1, "una sección larga se trocea");
  ok(cs.every((c) => c.length <= 950), "ningún chunk excede holgadamente el tamaño objetivo");
  const missing = [];
  for (let i = 0; i < 400; i++) if (!cs.some((c) => c.includes(`frase numero ${i} `))) missing.push(i);
  ok(missing.length === 0, `ninguna frase se pierde al trocear (faltan: ${missing.slice(0, 5)})`);
  ok(cs[0].includes("frase numero 0"), "el primer chunk contiene el inicio de la sección");
  ok(cs[cs.length - 1].includes("frase numero 399"), "el último chunk contiene el final");

  // El solape es lo que evita perder una frase que cruza un límite.
  const overlapping = cs.slice(0, -1).some((c, i) => {
    const tail = c.slice(-60);
    return cs[i + 1].includes(tail.slice(0, 30));
  });
  ok(overlapping, "los chunks consecutivos solapan");
}

// ── renderDocChunks ──────────────────────────────────────────────────────────
const mk = (section, text) => ({ ticker: "NVDA", form: "10-K", section, text, filed_date: "2026-02-01", fiscal_year: 2026 });

ok(renderDocChunks([]) === "", "sin pasajes → cadena vacía (los llamadores la concatenan al prompt)");

// EL BUG ORIGINAL: la versión vieja cortaba CADA pasaje a 1500 caracteres, que en un
// 10-K real es exactamente el preámbulo de Item 1A y ni un solo riesgo.
const long = "R".repeat(3000);
const out = renderDocChunks([mk("Risk Factors", long)]);
ok(out.includes(long), "un pasaje por debajo del presupuesto NO se trunca (esta era la regresión)");

// El presupuesto acota el bloque ENTERO, no cada pasaje.
const many = Array.from({ length: 20 }, (_, i) => mk("Risk Factors", "X".repeat(900) + " #" + i));
const capped = renderDocChunks(many, 3000);
ok(capped.length < 3600, `respeta el presupuesto total (${capped.length} chars)`);
ok(capped.includes("#0"), "conserva el pasaje más relevante (llega primero)");
ok(!capped.includes("#19"), "descarta el menos relevante cuando no cabe");

ok(out.startsWith("COMPANY FILINGS"), "emite la cabecera de grounding");
ok(out.includes("NVDA") && out.includes("Risk Factors"), "nombra ticker y sección para poder citarlas");
ok(renderDocChunks([mk("MD&A", "")]) === "", "un pasaje vacío no produce bloque");
ok(renderDocChunks([mk("MD&A", "   ")]) === "", "un pasaje en blanco tampoco");

// La consulta por defecto es lo que se usa cuando el llamador no aporta contexto. Si
// volviera a ser vacía, el retrieval degradaría a orden de documento — es decir, al bug.
ok(DEFAULT_FILING_QUERY.split(/\s+/).length >= 6, "la consulta por defecto es sustantiva");
ok(/risk/i.test(DEFAULT_FILING_QUERY), "la consulta por defecto busca riesgos");

console.log(failed === 0
  ? `\n✓ retrieval: ${passed} passed, 0 failed\n`
  : `\n✗ retrieval: ${passed} passed, ${failed} failed\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n`);
process.exit(failed ? 1 : 0);
