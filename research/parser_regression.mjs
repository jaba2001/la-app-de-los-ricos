// ─────────────────────────────────────────────────────────────────────────────
// PARSER REGRESSION HARNESS — runs the CURRENT section parser and a frozen copy of the
// PRE-2026-08-10 one over the same real 10-K bytes, and fails if the change lost ground.
//
// Why this exists: a parser change that fixes 6 companies and breaks 21 is a net loss, and
// the failure is silent — you don't get an exception, you get a thesis grounded in the
// wrong paragraph. The only honest way to change this code is to diff both versions over
// real filings.
//
// Filings are cached to research/out/filings_cache/ so iterating costs no SEC requests.
// Run: node --experimental-strip-types --no-warnings research/parser_regression.mjs [TICKERS…]
//      --refresh   re-download even if cached
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik } from "./edgar.mjs";
import { htmlToText, extractSections as extractNew, MAX_SECTION } from "./sectionParser.mjs";

const UA = "Scora Research contact@scora.app";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const CACHE = join(OUT, "filings_cache");
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT = [
  "NVDA","AAPL","MSFT","AMD","MU","GOOGL","META","AMZN","AVGO","WDC","STX","INTC",
  "TSLA","NFLX","ORCL","CRM","QCOM","TXN","DELL","PLTR","ADBE","NOW","PANW","AMAT","LRCX","ANET","CSCO","IBM",
];

// ── FROZEN reference: the parser exactly as it was before 2026-08-10 ─────────────────
// Do not "fix" anything in this block. Its entire purpose is to be the old behaviour.
const OLD_XREF = /^\s*(of\s+(this|our)\b|in\s+(part|this|note)\b|and\s+note\b|and\s+legal\b|and\s+other\b|,|"|”|;|–|-|section\b|above\b|below\b|for\s+(a|additional|further)\b|of\s+the\s+notes)/i;
const OLD_NAV = /(table of contents|in\s+part\s+i{1,2}\b|on\s+form\s*10-?k|in\s+this\s+annual\s+report|of\s+this\s+annual\s+report|financial\s+statements\s+included|notes\s+to\s+(consolidated|the)|item\s*[2-9][a-b]?\b)/i;
const oldSp = (w) => w.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");

function oldBestSection(text, startRe, endRes) {
  const ms = [...text.matchAll(new RegExp(startRe.source, "gi"))];
  if (!ms.length) return null;
  const cands = [];
  for (const m of ms) {
    const s = m.index, headingEnd = s + m[0].length;
    const before = text.slice(Math.max(0, s - 18), s);
    if (/\b(in|see|to|under|within|refer\s+to)\s+$/i.test(before)) continue;
    const tail = text.slice(headingEnd, headingEnd + 140);
    if (OLD_XREF.test(tail)) continue;
    if (OLD_NAV.test(tail.slice(0, 140))) continue;
    const after = text.slice(headingEnd);
    let e = after.length;
    for (const er of endRes) { const mm = after.search(new RegExp(er.source, "i")); if (mm >= 0 && mm < e) e = mm; }
    cands.push({ s, end: headingEnd + e, len: e });
  }
  if (!cands.length) return null;
  const best = cands.reduce((a, b) => (b.len > a.len ? b : a)); // LONGEST wins (the old rule)
  if (best.len < 1200) return null;
  return text.slice(best.s, best.end).replace(/\s+/g, " ").trim().slice(0, MAX_SECTION);
}

function extractOld(text) {
  const out = {};
  const biz = oldBestSection(text, new RegExp(`item\\s*1[.\\s)]+${oldSp("business")}`), [/item\s*1a[.\s)]/, /item\s*2[.\s)]/]);
  const risk = oldBestSection(text, new RegExp(`item\\s*1a[.\\s)]+${oldSp("risk")}\\s*${oldSp("factors")}`), [/item\s*1b[.\s)]/, /item\s*2[.\s)]/, /item\s*3[.\s)]/]);
  const mda = oldBestSection(text, new RegExp(`item\\s*7[.\\s)]+${oldSp("management")}[\\s’'\`]*s\\s+${oldSp("discussion")}`), [/item\s*7a[.\s)]/, /item\s*8[.\s)]/]);
  if (biz) out["Business"] = biz;
  if (risk) out["Risk Factors"] = risk;
  if (mda) out["MD&A"] = mda;
  return out;
}
// ── end frozen reference ─────────────────────────────────────────────────────────────

async function getText(url) {
  await sleep(150);
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (r.ok) return await r.text();
      if (r.status === 429) { await sleep(1500 * (a + 1)); continue; }
      return null;
    } catch { await sleep(700 * (a + 1)); }
  }
  return null;
}
async function getJSON(url) { const t = await getText(url); if (!t) return null; try { return JSON.parse(t); } catch { return null; } }

const REFRESH = process.argv.includes("--refresh");

/** Latest 10-K HTML for a ticker, from disk when possible. */
async function filingHtml(ticker) {
  const path = join(CACHE, `${ticker}.html`);
  if (!REFRESH && existsSync(path)) return readFileSync(path, "utf8");
  const cik = await tickerToCik(ticker);
  if (!cik) return null;
  const sub = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const rec = sub?.filings?.recent;
  if (!rec) return null;
  let i = -1;
  for (let k = 0; k < rec.form.length; k++) if (rec.form[k] === "10-K") { i = k; break; }
  if (i < 0) return null;
  const accNo = rec.accessionNumber[i].replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNo}/${rec.primaryDocument[i]}`;
  const html = await getText(url);
  if (html) writeFileSync(path, html);
  return html;
}

const SECTIONS = ["Business", "Risk Factors", "MD&A"];
const head = (s) => (s || "").slice(0, 80);

// Cambios de arranque REVISADOS A MANO y aceptados.
//
// Un arranque distinto no es automáticamente una regresión: la regla vieja (cuerpo más
// largo) se anclaba a veces en una referencia cruzada. Pero tampoco se puede dejar pasar
// sin mirarlo, así que cada uno vive aquí con su motivo. Un MOVED que NO esté en esta
// lista hace fallar el arnés — que es exactamente lo que quieres cuando alguien vuelva a
// tocar el parser.
const APPROVED_MOVES = {
  "STX/Business":
    'antes anclaba en la referencia cruzada «Item 1. Business— Executive Officers of the Registrant " is also incorporated by…» (mitad de frase); ahora en el encabezado real «ITEM 1. BUSINESS General Seagate is a leading provider…»',
  "CSCO/Business":
    'antes anclaba en la cita «Item 1. Business." Other Key Financial Measures…»; ahora en el encabezado real, y además completo (48k vs 42k) al dejar de cortar en una cita en línea a Item 1A',
};

const tickers = (process.argv.slice(2).filter((a) => !a.startsWith("--")).length
  ? process.argv.slice(2).filter((a) => !a.startsWith("--"))
  : DEFAULT).map((s) => s.toUpperCase());

console.log(`\n  PARSER REGRESSION · ${tickers.length} filings · cache: research/out/filings_cache\n`);

const lost = [];      // sección que el parser viejo tenía y el nuevo pierde  → REGRESIÓN
const moved = [];     // sección que ambos tienen pero arranca en otro sitio  → REVISAR A MANO
const gained = [];    // sección nueva                                        → mejora
const detail = [];    // texto comparativo de cada MOVED
const report = [];

let processed = 0;
for (const t of tickers) {
  let html;
  try { html = await filingHtml(t); } catch (e) { console.log(`  · ${t.padEnd(6)} error ${e?.message ?? e}`); continue; }
  if (!html) { console.log(`  · ${t.padEnd(6)} sin filing`); continue; }
  processed++;
  const text = htmlToText(html);
  const o = extractOld(text);
  const n = extractNew(text);

  const marks = SECTIONS.map((sec) => {
    const has = { old: !!o[sec], new: !!n[sec] };
    if (has.old && !has.new) { lost.push(`${t}/${sec}`); return `${sec}:LOST`; }
    if (!has.old && has.new) { gained.push(`${t}/${sec}`); return `${sec}:+${Math.round(n[sec].length / 1000)}k`; }
    if (has.old && has.new) {
      if (head(o[sec]) !== head(n[sec])) {
        moved.push(`${t}/${sec}`);
        // Always show both starts. A MOVED section is not automatically a regression —
        // the old longest-wins rule could have been anchoring in the wrong place — but it
        // is never something to wave through, so print the evidence needed to judge.
        detail.push(
          `  ${t}/${sec}\n` +
          `    ANTES (${o[sec].length} chars): ${head(o[sec])}\n` +
          `    AHORA (${n[sec].length} chars): ${head(n[sec])}`
        );
        return `${sec}:MOVED`;
      }
      return `${sec}:=`;
    }
    return null;
  }).filter(Boolean);

  report.push({ ticker: t, old: Object.keys(o), new: Object.keys(n) });
  console.log(`  ${t.padEnd(6)} ${marks.join("  ")}`);
}

// Persist for eyeballing / CI artefacts.
writeFileSync(join(OUT, "parser_regression.json"), JSON.stringify(report, null, 2));

console.log(`\n  ── resultado ──`);
console.log(`  filings analizados: ${processed}/${tickers.length}`);
// Sin filings no se ha verificado NADA. Es un fallo de red, no una regresión, así que no
// bloquea; pero decirlo en voz alta evita el peor resultado posible: un verde vacío que
// alguien interpreta como "el parser está bien".
if (processed === 0) {
  console.log(`\n  ⚠ NADA VERIFICADO — no se pudo descargar ningún filing (¿red? ¿SEC caída?).`);
  console.log(`    Esto NO es un aprobado del parser. Reejecuta cuando haya conexión.\n`);
  process.exit(0);
}
console.log(`  secciones ganadas : ${gained.length}${gained.length ? ` (${gained.join(", ")})` : ""}`);
console.log(`  secciones perdidas: ${lost.length}${lost.length ? ` (${lost.join(", ")})` : ""}`);
const unreviewed = moved.filter((k) => !APPROVED_MOVES[k]);
console.log(`  arranque cambiado : ${moved.length} (${moved.length - unreviewed.length} revisados y aceptados, ${unreviewed.length} sin revisar)`);
if (detail.length) console.log(`\n  ── arranques cambiados, en detalle ──\n${detail.join("\n")}`);
if (unreviewed.length) {
  console.log(`\n  ⚠ SIN REVISAR: ${unreviewed.join(", ")}`);
  console.log(`    Compara los arranques de arriba. Si el nuevo es el encabezado real,`);
  console.log(`    añádelo a APPROVED_MOVES con el motivo. Si no, el parser ha empeorado.`);
}

const ok = lost.length === 0 && unreviewed.length === 0;
console.log(ok
  ? `\n  ✓ PASS — 0 secciones perdidas, ${gained.length} recuperadas, ${moved.length} movimientos revisados\n`
  : `\n  ✗ FAIL — ${lost.length} perdidas, ${unreviewed.length} movimientos sin revisar\n`);
process.exit(ok ? 0 : 1);
