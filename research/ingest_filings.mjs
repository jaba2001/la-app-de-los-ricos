// ─────────────────────────────────────────────────────────────────────────────
// FILING INGESTION (Phase 3) — the "second brain per company". Pulls each name's
// latest 10-K from SEC EDGAR (free, public, no API key), strips it to text, and
// splits the three sections an analyst actually reads — Business (Item 1),
// Risk Factors (Item 1A), MD&A (Item 7) — into Supabase kb_docs. The AI thesis /
// research report then RETRIEVE these verbatim excerpts and CITE them, so the model
// reasons from the real filing instead of training-data memory (Karpathy grounding).
// Reuses research/edgar.mjs (tickerToCik). Free end-to-end.
// Run: node --experimental-strip-types --no-warnings research/ingest_filings.mjs [TICKERS…]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik } from "./edgar.mjs";
import { htmlToText, extractSections } from "./sectionParser.mjs";

const UA = "Scora Research contact@scora.app"; // SEC requires a descriptive UA
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Default seed universe — liquid US filers with 10-Ks that the app's users hit most
// (AI-capex / memory complex + mega-cap tech + high-traffic names). Foreign issuers
// (ASML=20-F) are skipped. INTC is a known structural miss: its primary 10-K doc is a
// paginated wrapper whose section headings only appear as TOC page-refs, so the item-
// heading parser can't anchor the bodies — it skips gracefully rather than store garbage.
const DEFAULT = [
  "NVDA","AAPL","MSFT","AMD","MU","GOOGL","META","AMZN","AVGO","WDC","STX","INTC",
  "TSLA","NFLX","ORCL","CRM","QCOM","TXN","DELL","PLTR","ADBE","NOW","PANW","AMAT","LRCX","ANET","CSCO","IBM",
];
// Chars kept per section. Was 2 200 — sized for the old "inject the whole section into
// the prompt" model, which meant a 10-K's Risk Factors (tens of pages) was cut down to its
// standard preamble and the grounded thesis ended up citing the header instead of the
// risks. Now the section is chunked and retrieved by relevance, so the store can hold the
// real thing; the prompt still only ever receives the handful of chunks that matched.
// El tope por sección (MAX_SECTION) lo aplica ./sectionParser.mjs, no este fichero.

// Retrieval chunking. ~900 chars is a few paragraphs — big enough to carry a complete
// risk or driver, small enough that an irrelevant chunk costs little context. The overlap
// stops a statement that straddles a boundary from being lost by both neighbours.
const CHUNK_CHARS = 900;
const CHUNK_OVERLAP = 120;

// Sentinel for ingestTicker's skip paths. Frozen so an accidental push into it can't
// leak rows from one ticker into the next.
const EMPTY = Object.freeze({ rows: Object.freeze([]), chunks: Object.freeze([]) });

/** Split a section into overlapping chunks, preferring sentence boundaries. */
function chunkText(text, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      // Back off to the last sentence end in the final quarter of the window, so chunks
      // don't start mid-sentence (which reads badly when quoted back in a thesis).
      const window = clean.slice(i, end);
      const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      if (cut > size * 0.75) end = i + cut + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - overlap, i + 1); // the max() guarantees forward progress
  }
  return out;
}

async function getText(url) {
  await sleep(120); // SEC fair-access (<10 req/s)
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA } }); if (r.ok) return await r.text(); if (r.status === 429) { await sleep(1200 * (a + 1)); continue; } return null; }
    catch { await sleep(600 * (a + 1)); }
  }
  return null;
}
async function getJSON(url) { const t = await getText(url); if (!t) return null; try { return JSON.parse(t); } catch { return null; } }

// El parser de secciones (htmlToText / extractSections) vive ahora en
// ./sectionParser.mjs, importado arriba. Estaba aquí en línea, y eso significaba que el
// arnés de regresión no podía ejercitarlo sin duplicarlo — un parser de heurísticas que
// no se puede contrastar contra filings reales se rompe en silencio. Ver
// research/parser_regression.mjs, que compara esta versión con la anterior sobre 28
// 10-K cacheados y falla si pierde terreno.

async function ingestTicker(t) {
  const cik = await tickerToCik(t);
  if (!cik) { console.log(`  · ${t.padEnd(6)} no CIK — skip`); return EMPTY; }
  const sub = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const rec = sub?.filings?.recent;
  if (!rec) { console.log(`  · ${t.padEnd(6)} no submissions — skip`); return EMPTY; }
  // newest 10-K
  let idx = -1;
  for (let i = 0; i < rec.form.length; i++) { if (rec.form[i] === "10-K") { idx = i; break; } }
  if (idx < 0) { console.log(`  · ${t.padEnd(6)} no 10-K — skip`); return EMPTY; }
  const accession = rec.accessionNumber[idx];
  const primary = rec.primaryDocument[idx];
  const filed = rec.filingDate[idx];
  const reportDate = rec.reportDate?.[idx] ?? filed;
  const fy = reportDate ? Number(String(reportDate).slice(0, 4)) : null;
  const accNo = accession.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNo}/${primary}`;
  const html = await getText(url);
  if (!html) { console.log(`  · ${t.padEnd(6)} 10-K ${accession} fetch failed`); return EMPTY; }
  const text = htmlToText(html);
  const sections = extractSections(text);
  const names = Object.keys(sections);
  if (!names.length) { console.log(`  · ${t.padEnd(6)} 10-K ${accession} — no sections parsed (${(text.length/1000).toFixed(0)}k chars)`); return EMPTY; }
  const now = new Date().toISOString();
  const rows = names.map((section) => ({
    id: `${t}_${accNo}_${section.replace(/[^A-Za-z]/g, "")}`,
    ticker: t, cik, form: "10-K", accession, section,
    // kb_docs keeps its original 2 200-char shape so anything still reading that table
    // (and the fallback path in lib/knowledge.ts) behaves exactly as before.
    text: sections[section].slice(0, 2200), filed_date: filed, fiscal_year: fy, source_url: url, updated_at: now,
  }));
  // kb_chunks: the full section, split for retrieval.
  const chunks = [];
  for (const section of names) {
    const pieces = chunkText(sections[section]);
    pieces.forEach((piece, i) => {
      chunks.push({
        id: `${t}_${accNo}_${section.replace(/[^A-Za-z]/g, "")}_${i}`,
        ticker: t, cik, form: "10-K", accession, section,
        chunk_idx: i, text: piece, filed_date: filed, fiscal_year: fy, source_url: url, updated_at: now,
      });
    });
  }
  console.log(`  ✓ ${t.padEnd(6)} 10-K FY${fy ?? "?"} (${filed}) → ${names.map((n) => `${n} ${(sections[n].length/1000).toFixed(1)}k`).join(", ")} · ${chunks.length} chunks`);
  return { rows, chunks };
}

const tickers = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT).map((s) => s.toUpperCase());
console.log(`\n  FILING INGESTION · ${tickers.length} names · latest 10-K → kb_docs\n`);

const all = [];
const allChunks = [];
for (const t of tickers) {
  try {
    const { rows, chunks } = await ingestTicker(t);
    all.push(...rows);
    allChunks.push(...chunks);
  } catch (e) { console.log(`  · ${t} error ${e?.message ?? e}`); }
}

writeFileSync(join(OUT, "kb_docs.json"), JSON.stringify(all, null, 2));
console.log(`\n  → wrote research/out/kb_docs.json (${all.length} section rows, ${new Set(all.map(r=>r.ticker)).size} companies)`);
writeFileSync(join(OUT, "kb_chunks.json"), JSON.stringify(allChunks, null, 2));
console.log(`  → wrote research/out/kb_chunks.json (${allChunks.length} chunks)`);

const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

/** Upsert in batches — a single 20 MB body would be rejected by PostgREST. */
async function upsert(table, rows, batch = 500) {
  let ok = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const resp = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(slice),
    });
    if (resp.ok) ok += slice.length;
    else console.log(`  ${table} batch ${i}: ${resp.status} ${await resp.text().catch(() => "")}`);
  }
  console.log(`  Supabase ${table}: ${ok}/${rows.length} rows upserted`);
}

if (SB_KEY && all.length) {
  await upsert("kb_docs", all);
  // kb_chunks is what the grounded thesis actually retrieves from now on. If this table
  // doesn't exist yet, run ic-proxy/sql/2026-07-29_kb_chunks_fts.sql first — the app
  // falls back to kb_docs until then, so nothing breaks in the meantime.
  await upsert("kb_chunks", allChunks);
} else {
  console.log("  (no SUPABASE_SERVICE_KEY — seed kb_docs/kb_chunks from the JSON via MCP)");
}
