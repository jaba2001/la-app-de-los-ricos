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
        rows.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), adj: adjc?.[i] ?? q.close[i], raw: q.close[i] });
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
  // `c[0].raw != null` invalida las cachés escritas antes de guardar el cierre crudo: sin
  // él no se pueden calcular múltiplos de valoración (un PER contra el cierre AJUSTADO por
  // dividendos está sistemáticamente subestimado cuanto más atrás se mire).
  if (existsSync(path)) { try { const c = JSON.parse(readFileSync(path, "utf8")); if (Array.isArray(c) && c.length && c[0].raw != null) rows = c; } catch { rows = null; } }
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

const idxOnOrBefore = (rows, date) => { let lo = 0, hi = rows.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].date <= date) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };

// Mismas firmas que `rawPriceAsOf` y `momentum` de prices.mjs, para poder inyectarlas en
// `collectRows` y estudiar los pilares de VALORACIÓN y MOMENTUM antes de 2018-06, que es
// donde arranca la caché corta. Sin esto, cualquier análisis de los cuatro pilares en la
// ventana 2011-2018 salía con value y momentum a cero y nadie se enteraba.
export async function rawPriceAsOfLong(ticker, date) {
  const r = await seriesLong(ticker); const i = idxOnOrBefore(r, date);
  return i < 0 ? null : r[i].raw ?? null;
}
export async function momentumLong(ticker, date) {
  const r = await seriesLong(ticker); const i = idxOnOrBefore(r, date);
  if (i < 130) return { m1: null, m3: null, m6: null };
  const cur = r[i].adj;
  const pct = (n) => { const p = i - n >= 0 ? r[i - n].adj : null; return p && p > 0 ? ((cur - p) / p) * 100 : null; };
  return { m1: pct(21), m3: pct(63), m6: pct(126) };
}
