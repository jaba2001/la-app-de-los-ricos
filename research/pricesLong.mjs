// ─────────────────────────────────────────────────────────────────────────────
// PRECIOS DE HISTORIA LARGA — solo para el análisis de potencia de `momentum_audit.mjs`.
//
// Por qué existe en vez de reutilizar `prices.mjs`: la caché de aquél está fijada en
// PX_FROM=2018-06 y NO registra el rango descargado, así que pedirle más historia exigiría
// invalidar la caché que comparten discovery, breadth, el paper fund y media docena de labs.
// Este módulo escribe en `.cache/px_long/` — directorio propio, cero efectos colaterales
// sobre nada de lo que ya funciona.
//
// Solo Yahoo (gratis, sin token) y solo lo que el audit necesita: log-retornos totales.
// No cubre deslistados: eso está declarado como salvedad en el informe, no disimulado.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache", "px_long");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
const FROM = process.env.PXL_FROM || "2009-01-01";
const P1 = Math.floor(new Date(FROM).getTime() / 1000);
const P2 = Math.floor(Date.now() / 1000);
const mem = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fromYahoo(ticker) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${P1}&period2=${P2}&interval=1d&events=split`, { headers: { "User-Agent": UA } });
      if (r.status === 429) { await sleep(2000 * (a + 1)); continue; }
      const res = (await r.json())?.chart?.result?.[0];
      if (!res?.timestamp) return [];
      const ts = res.timestamp, q = res.indicators.quote[0], adjc = res.indicators.adjclose?.[0]?.adjclose;
      const rows = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close[i] == null) continue;
        rows.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), adj: adjc?.[i] ?? q.close[i] });
      }
      return rows.sort((x, y) => x.date.localeCompare(y.date));
    } catch { await sleep(800 * (a + 1)); }
  }
  return [];
}

async function seriesLong(ticker) {
  if (mem.has(ticker)) return mem.get(ticker);
  const path = join(DIR, ticker.replace(/[^A-Za-z0-9_.-]/g, "") + ".json");
  let rows = null;
  if (existsSync(path)) { try { const c = JSON.parse(readFileSync(path, "utf8")); if (Array.isArray(c) && c.length) rows = c; } catch { rows = null; } }
  if (!rows) {
    await sleep(120);
    rows = await fromYahoo(ticker);
    if (rows.length) writeFileSync(path, JSON.stringify(rows));
  }
  rows = rows ?? [];
  mem.set(ticker, rows);
  return rows;
}

/** Misma forma que `returnsSeries` de prices.mjs: [{date, ret}] con log-retornos totales. */
export async function returnsSeriesLong(ticker) {
  const r = await seriesLong(ticker);
  const out = [];
  for (let k = 1; k < r.length; k++) {
    const p0 = r[k - 1].adj, p1 = r[k].adj;
    if (p0 > 0 && p1 > 0) out.push({ date: r[k].date, ret: Math.log(p1 / p0) });
  }
  return out;
}
