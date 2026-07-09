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
// Chars stored per section. Sized to what the grounded thesis injects (~2k/section) to
// keep the KB lean and cheap; the Phase-4 research report can re-ingest deeper when built.
const MAX_SECTION = 2200;

async function getText(url) {
  await sleep(120); // SEC fair-access (<10 req/s)
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA } }); if (r.ok) return await r.text(); if (r.status === 429) { await sleep(1200 * (a + 1)); continue; } return null; }
    catch { await sleep(600 * (a + 1)); }
  }
  return null;
}
async function getJSON(url) { const t = await getText(url); if (!t) return null; try { return JSON.parse(t); } catch { return null; } }

// HTML → readable text: drop script/style/tables-of-numbers noise, tags → space,
// decode the handful of entities EDGAR uses, collapse whitespace.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#8217;|&#x2019;|&rsquo;/gi, "’").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#8212;|&mdash;/gi, "—").replace(/&#8211;|&ndash;/gi, "–")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A "heading" match is a CROSS-REFERENCE ("…see Item 1A. Risk Factors of this Form 10-K",
// "Item 1 Business and Note 15…"), not the real section title, when it's immediately
// followed by citation language. Those must be rejected or they hijack the extraction.
const XREF = /^\s*(of\s+(this|our)\b|in\s+(part|this|note)\b|and\s+note\b|and\s+legal\b|and\s+other\b|,|"|”|;|–|-|section\b|above\b|below\b|for\s+(a|additional|further)\b|of\s+the\s+notes)/i;
// A real section body doesn't reference OTHER items, the TOC, or "this Form 10-K" in its
// opening line — those markers mean we've matched a cross-reference sentence, not the title.
const NAV = /(table of contents|in\s+part\s+i{1,2}\b|on\s+form\s*10-?k|in\s+this\s+annual\s+report|of\s+this\s+annual\s+report|financial\s+statements\s+included|notes\s+to\s+(consolidated|the)|item\s*[2-9][a-b]?\b)/i;

// Pick the REAL section body, not a TOC entry, running header, or cross-reference.
// Among every "Item X …" heading occurrence: reject cross-references (citation tail), then
// keep the candidate whose body (up to the next section heading) is the LONGEST — the real
// section is by far the longest run of prose; TOC/header matches have tiny gaps.
function bestSection(text, startRe, endRes) {
  const ms = [...text.matchAll(new RegExp(startRe.source, "gi"))];
  if (!ms.length) return null;
  const cands = [];
  for (const m of ms) {
    const s = m.index, headingEnd = s + m[0].length;
    const before = text.slice(Math.max(0, s - 18), s);
    if (/\b(in|see|to|under|within|refer\s+to)\s+$/i.test(before)) continue; // "…discussion in Item 7…" = a cross-reference mid-sentence, not a heading
    const tail = text.slice(headingEnd, headingEnd + 140);
    if (XREF.test(tail)) continue;                 // heading followed by citation language
    if (NAV.test(tail.slice(0, 140))) continue;    // opening references another item / the TOC
    const after = text.slice(headingEnd);
    let e = after.length;
    for (const er of endRes) { const mm = after.search(new RegExp(er.source, "i")); if (mm >= 0 && mm < e) e = mm; }
    cands.push({ s, end: headingEnd + e, len: e });
  }
  if (!cands.length) return null;
  const best = cands.reduce((a, b) => (b.len > a.len ? b : a));
  if (best.len < 1200) return null; // too short → a TOC/header match, not the real section
  return text.slice(best.s, best.end).replace(/\s+/g, " ").trim().slice(0, MAX_SECTION);
}

// Some filers (MSFT, INTC…) render section titles with per-letter letter-spacing, so
// after stripping tags a heading reads "RIS K FACTORS" / "B USINESS" / "MANAGEMENT S
// DISCUSSION". Match each keyword letter-by-letter with optional whitespace between —
// which still matches ordinary contiguous headings too.
const sp = (w) => w.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
function extractSections(text) {
  const out = {};
  const biz = bestSection(text, new RegExp(`item\\s*1[.\\s)]+${sp("business")}`), [/item\s*1a[.\s)]/, /item\s*2[.\s)]/]);
  const risk = bestSection(text, new RegExp(`item\\s*1a[.\\s)]+${sp("risk")}\\s*${sp("factors")}`), [/item\s*1b[.\s)]/, /item\s*2[.\s)]/, /item\s*3[.\s)]/]);
  const mda = bestSection(text, new RegExp(`item\\s*7[.\\s)]+${sp("management")}[\\s’'\`]*s\\s+${sp("discussion")}`), [/item\s*7a[.\s)]/, /item\s*8[.\s)]/]);
  if (biz) out["Business"] = biz;
  if (risk) out["Risk Factors"] = risk;
  if (mda) out["MD&A"] = mda;
  return out;
}

async function ingestTicker(t) {
  const cik = await tickerToCik(t);
  if (!cik) { console.log(`  · ${t.padEnd(6)} no CIK — skip`); return []; }
  const sub = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const rec = sub?.filings?.recent;
  if (!rec) { console.log(`  · ${t.padEnd(6)} no submissions — skip`); return []; }
  // newest 10-K
  let idx = -1;
  for (let i = 0; i < rec.form.length; i++) { if (rec.form[i] === "10-K") { idx = i; break; } }
  if (idx < 0) { console.log(`  · ${t.padEnd(6)} no 10-K — skip`); return []; }
  const accession = rec.accessionNumber[idx];
  const primary = rec.primaryDocument[idx];
  const filed = rec.filingDate[idx];
  const reportDate = rec.reportDate?.[idx] ?? filed;
  const fy = reportDate ? Number(String(reportDate).slice(0, 4)) : null;
  const accNo = accession.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNo}/${primary}`;
  const html = await getText(url);
  if (!html) { console.log(`  · ${t.padEnd(6)} 10-K ${accession} fetch failed`); return []; }
  const text = htmlToText(html);
  const sections = extractSections(text);
  const names = Object.keys(sections);
  if (!names.length) { console.log(`  · ${t.padEnd(6)} 10-K ${accession} — no sections parsed (${(text.length/1000).toFixed(0)}k chars)`); return []; }
  const now = new Date().toISOString();
  const rows = names.map((section) => ({
    id: `${t}_${accNo}_${section.replace(/[^A-Za-z]/g, "")}`,
    ticker: t, cik, form: "10-K", accession, section,
    text: sections[section], filed_date: filed, fiscal_year: fy, source_url: url, updated_at: now,
  }));
  console.log(`  ✓ ${t.padEnd(6)} 10-K FY${fy ?? "?"} (${filed}) → ${names.map((n) => `${n} ${(sections[n].length/1000).toFixed(1)}k`).join(", ")}`);
  return rows;
}

const tickers = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT).map((s) => s.toUpperCase());
console.log(`\n  FILING INGESTION · ${tickers.length} names · latest 10-K → kb_docs\n`);

const all = [];
for (const t of tickers) { try { all.push(...(await ingestTicker(t))); } catch (e) { console.log(`  · ${t} error ${e?.message ?? e}`); } }

writeFileSync(join(OUT, "kb_docs.json"), JSON.stringify(all, null, 2));
console.log(`\n  → wrote research/out/kb_docs.json (${all.length} section rows, ${new Set(all.map(r=>r.ticker)).size} companies)`);

const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (SB_KEY && all.length) {
  const resp = await fetch(`${SB_URL}/rest/v1/kb_docs?on_conflict=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(all),
  });
  console.log(`  Supabase upsert: ${resp.status} ${resp.ok ? "OK" : await resp.text()}`);
} else {
  console.log("  (no SUPABASE_SERVICE_KEY — seed kb_docs from the JSON via MCP)");
}
