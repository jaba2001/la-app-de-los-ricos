// PROOF-OF-CONCEPT / engine smoke test: point-in-time Scora score for a past date
// from 100% free data, then realized forward return vs SPY. Reuses production
// scoring.ts via the shared adapter. Run:
//   node --experimental-strip-types --no-warnings research/poc.mjs [asOf] [fwd]
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { rawPriceAsOf, priceAsOf, momentum, fwdReturn } from "./prices.mjs";
import { scoreStock } from "./score.mjs";
import { getRating } from "../lib/scoring.ts";

const AS_OF = process.argv[2] || "2021-05-28";
const FWD = process.argv[3] || "2022-05-27";
const TICKERS = ["AAPL", "MSFT", "NVDA", "JPM", "KO", "XOM"];
const pct = (v, d = 1) => (v == null ? "  —  " : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);
const num = (v, d = 1) => (v == null ? "—" : v.toFixed(d));

const spyRet = await fwdReturn("SPY", AS_OF, FWD);
console.log(`\n  SCORA — point-in-time score as of ${AS_OF} → forward return to ${FWD}   (SPY ${pct(spyRet)}%)\n`);
console.log("  Ticker  Sector          Score Rating       PE    EV/E   ROE   RevGr  | filed≤asOf   vs SPY");
console.log("  " + "─".repeat(92));

const results = [];
for (const t of TICKERS) {
  const cik = await tickerToCik(t);
  const f = cik ? await fundamentalsAsOf(cik, AS_OF) : null;
  const raw = await rawPriceAsOf(t, AS_OF);
  if (!f || f.revTTM == null || raw == null) { console.log(`  ${t.padEnd(7)} insufficient coverage`); continue; }
  const sector = await sicSector(cik);
  const mom = await momentum(t, AS_OF);
  const { inputs, scores, ic } = scoreStock(f, raw, mom, sector);
  const fwd = await fwdReturn(t, AS_OF, FWD);
  const alpha = fwd != null && spyRet != null ? fwd - spyRet : null;
  results.push({ t, ic, alpha, inputs });
  console.log(
    `  ${t.padEnd(7)} ${(sector || "?").slice(0, 14).padEnd(15)}${String(scores.total).padStart(4)}  ${getRating(ic).label.padEnd(11)}` +
    `${num(inputs.pe).padStart(6)} ${num(inputs.evEbitda).padStart(6)} ${num(inputs.roe).padStart(5)}% ${pct(inputs.revenueGrowth).padStart(6)}% | ` +
    `${(f.asOfLatestFiling ?? "—").padEnd(10)} ${pct(alpha).padStart(7)}%`
  );
}
const buy = results.filter((r) => r.ic >= 60 && r.alpha != null);
const rest = results.filter((r) => r.ic < 60 && r.alpha != null);
const avg = (a) => (a.length ? a.reduce((s, r) => s + r.alpha, 0) / a.length : null);
console.log("  " + "─".repeat(92));
console.log(`\n  score≥60: n=${buy.length} avg alpha ${pct(avg(buy))}%  |  score<60: n=${rest.length} avg alpha ${pct(avg(rest))}%`);
console.log(`  (6 names, 1 date, no macro tilt — validates the pipeline, not the edge.)\n`);
