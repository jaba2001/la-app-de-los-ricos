import { tickerToCik, fundamentalsAsOf } from "./edgar.mjs";
import { rawPriceAsOf } from "./prices.mjs";
import { CURATED } from "./universe.mjs";
const asOf = process.argv[2] || new Date().toISOString().slice(0, 10);
console.log(`coverage diagnostic as of ${asOf}\n`);
for (const t of CURATED) {
  const cik = await tickerToCik(t);
  const f = cik ? await fundamentalsAsOf(cik, asOf) : null;
  const raw = await rawPriceAsOf(t, asOf);
  const miss = [];
  if (!cik) miss.push("no-cik");
  if (cik && !f) miss.push("no-facts");
  if (f && f.revTTM == null) miss.push("rev");
  if (f && f.niTTM == null) miss.push("ni");
  if (f && f.equity == null) miss.push("equity");
  if (f && f.assets == null) miss.push("assets");
  if (f && f.shares == null) miss.push("shares");
  if (raw == null) miss.push("price");
  const ok = f && f.revTTM != null && raw != null;
  console.log(`  ${t.padEnd(6)} ${ok ? "OK " : "SKIP"} ${miss.length ? "missing: " + miss.join(",") : ""}`);
}
