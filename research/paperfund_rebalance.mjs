// ─────────────────────────────────────────────────────────────────────────────
// PAPER FUND · monthly rebalance (Phase 8). The autonomous, living proof of the model:
// each month it computes the SAME validated allocation the app shows — liquidity-led
// risk-on tilt (blendWeights) + Antonacci absolute momentum (applyDualMomentum) — and
// seals an immutable target-weight snapshot to sl_paper_fund. No discretion, no hindsight.
// Reuses research/allocate.mjs (the shared allocator) + prices.mjs (12-1m momentum).
// Run: SUPABASE_SERVICE_KEY=… node --experimental-strip-types --no-warnings research/paperfund_rebalance.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ASSETS, growthWeights, applyDualMomentum } from "./allocate.mjs";
import { fwdReturn } from "./prices.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const addMonths = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// 1) current risk-on from the live macro_state row (the same field the app reads).
//
// ⚠️ UN FALLO DE RED NO PUEDE VALER 50, y valía. Esto decide un CAMBIO DE RÉGIMEN —≥50 acciones,
// <50 cesta defensiva— así que el `?? 50` de antes dejaba cualquier error justo en la frontera
// y **del lado de acciones**. Si Supabase no respondía y el régimen real era 20, el fondo se
// rebalanceaba entero a renta variable; y la fila que escribía decía `risk_on: 50`, afirmando
// en la base de datos un dato que nadie había observado.
//
// Es el mismo defecto que ya bloqueó a Avon, acusó a Equity Residential y borró a Marathon Oil
// del mapa de CIK: «no he podido mirar» valiendo como un hecho. Aquí era el más caro de los
// cuatro, porque es la ruta que asigna el dinero.
//
// Devuelve el número, o `NO_SE_SABE`. Quien llama NO puede rellenarlo con un valor por defecto.
const NO_SE_SABE = Symbol("risk-on: no se pudo leer");
async function fetchRiskOn() {
  if (!SB_KEY) return NO_SE_SABE;
  for (let intento = 0; intento < 3; intento++) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/macro_state?id=eq.1&select=risk_on`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
      if (r.ok) {
        const j = await r.json();
        const v = Array.isArray(j) ? Number(j[0]?.risk_on) : NaN;
        // Una fila que existe y trae un risk_on ilegible SÍ es una respuesta rara, pero no es
        // «no he podido preguntar»: se distingue igualmente, porque tampoco se puede inventar.
        return Number.isFinite(v) ? v : NO_SE_SABE;
      }
    } catch { /* se reintenta */ }
    await new Promise((ok) => setTimeout(ok, 800 * (intento + 1)));
  }
  return NO_SE_SABE;
}

const riskOnLeido = process.env.RISK_ON != null ? Number(process.env.RISK_ON) : await fetchRiskOn();
if (riskOnLeido === NO_SE_SABE || !Number.isFinite(riskOnLeido)) {
  console.error(`
  ⛔ No se ha podido leer el risk-on, así que NO se rebalancea.`);
  console.error(`     Este valor decide el régimen (>=50 acciones, <50 defensivo). Rellenarlo con`);
  console.error(`     un 50 por defecto pondría la cartera en acciones por un fallo de red, y`);
  console.error(`     dejaría escrito en la base un risk_on que nadie ha medido.`);
  console.error(`     Si hace falta forzarlo, RISK_ON=<n> en el entorno.
`);
  process.exit(1);
}
const riskOn = riskOnLeido;
console.log(`\n  PAPER FUND rebalance · ${today} · risk-on ${riskOn.toFixed(1)}`);

// 2) GROWTH mandate: regime switch — equities when risk-on (≥50), defensive basket
// otherwise, with a small BTC sleeve (carved from equities, never leverage) when risk-on
// AND BTC's 12-1m trend is up — then 3) the 12-1m momentum gate. No risk-parity (defensive
// feature). The mandate is disclosed in the rebalance note, like any fund would.
const mom = {};
for (const a of ASSETS) {
  try { mom[a] = await fwdReturn(a, addMonths(today, -12), addMonths(today, -1)); } catch { mom[a] = null; }
}
const base = growthWeights(riskOn, mom.BTCUSD);
const gated = applyDualMomentum(base, mom).weights;
const movedToCash = applyDualMomentum(base, mom).movedToCash;
// round + renormalize for a clean snapshot
let sum = 0; for (const a of ASSETS) sum += gated[a];
const w = {}; for (const a of ASSETS) w[a] = +(gated[a] / (sum || 1)).toFixed(4);

console.log("  target weights:", Object.entries(w).map(([a, v]) => `${a} ${(v * 100).toFixed(0)}%`).join("  "));
console.log("  moved to cash:", movedToCash.length ? movedToCash.join(", ") : "none");

const btcNote = (w.BTCUSD || 0) > 0 ? `; ${(w.BTCUSD * 100).toFixed(0)}% BTC sleeve (uptrend)` : "";
const row = { rebalance_date: today, weights: w, risk_on: +riskOn.toFixed(1), moved_to_cash: movedToCash, note: `GROWTH mandate: risk-on ${riskOn.toFixed(0)} → ${riskOn >= 50 ? "equities" : "defensive basket"}${btcNote}; momentum gate → ${movedToCash.length ? movedToCash.join("/") + " to cash" : "all sleeves kept"}` };
writeFileSync(join(OUT, "paperfund_rebalance.json"), JSON.stringify(row, null, 2));
console.log(`  → wrote research/out/paperfund_rebalance.json`);

if (SB_KEY) {
  const resp = await fetch(`${SB_URL}/rest/v1/sl_paper_fund?on_conflict=rebalance_date`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
  console.log(`  Supabase upsert: ${resp.status} ${resp.ok ? "OK" : await resp.text()}`);
} else {
  console.log("  (no SUPABASE_SERVICE_KEY — seed sl_paper_fund from the JSON)");
}
