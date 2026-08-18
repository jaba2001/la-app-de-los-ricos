// ─────────────────────────────────────────────────────────────────────────────
// MOTOR DE SEÑALES DE MOMENTUM — compartido por `momentum_lab.mjs` (que mide) y
// `momentum_audit.mjs` (que audita al que mide).
//
// Está extraído a su propio módulo por una razón concreta: si la auditoría tuviera su
// PROPIA copia del cálculo, no estaría auditando el lab — estaría comparando dos
// implementaciones distintas y cualquier coincidencia sería casualidad. Una sola fuente
// de verdad para las señales, dos consumidores.
//
// Verificado contra un cálculo independiente sobre precios ajustados (`priceAsOf`):
// 20/20 comprobaciones exactas en ROC 12-1m, ROC 63, distancia al máximo de 52 semanas,
// volatilidad anualizada e information discreteness (AAPL, JPM, XOM, NVDA @ 2024-01-02).
// ─────────────────────────────────────────────────────────────────────────────
import { returnsSeries } from "./prices.mjs";

// ── utilidades de fecha y estadística ────────────────────────────────────────────
export const addMonths = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
export const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export const fx = (x, n = 4) => (x == null ? null : +x.toFixed(n));

export function rank(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++; const avg = (i + j - 1) / 2 + 1; for (let k = i; k < j; k++) r[idx[k][1]] = avg; i = j; } return r; }
export function spearman(x, y) { if (x.length < 8) return null; const rx = rank(x), ry = rank(y), mx = mean(rx), my = mean(ry); let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; } return dx && dy ? n / Math.sqrt(dx * dy) : null; }

// ── panel de precios por nombre, TODO derivado de log-retornos diarios ───────────
// cum[i] = Σ log-retornos hasta i  →  ROC(N) = exp(cum[i] − cum[i−N]) − 1.
// Así no hace falta tocar prices.mjs: `returnsSeries` ya da (fecha, log-retorno adj).
// `seriesFn` inyectable para que la auditoría pueda pasar una fuente de historia LARGA
// (`pricesLong.mjs`) sin duplicar el motor de señales ni tocar la caché compartida.
// Por defecto usa la de siempre → todos los llamadores existentes se comportan igual.
export async function loadPanel(ticker, seriesFn = returnsSeries) {
  const rs = await seriesFn(ticker);
  if (rs.length < 300) return null;
  const dates = rs.map((x) => x.date), ret = rs.map((x) => x.ret);
  const cum = new Array(ret.length);
  let s = 0; for (let i = 0; i < ret.length; i++) { s += ret[i]; cum[i] = s; }
  return { dates, ret, cum };
}
export const idxOnOrBefore = (dates, date) => { let lo = 0, hi = dates.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= date) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
export const roc = (p, i, n) => (i - n < 0 ? null : Math.exp(p.cum[i] - p.cum[i - n]) - 1);

/** Todas las señales de un nombre en el índice de sesión `i`, usando SOLO datos ≤ i. */
export function signalsAt(p, i, spyMap) {
  if (i < 260) return null;                       // exige ~13 meses de historia
  const W_SKIP = 21, W_12 = 252, W_6 = 126;       // sesiones ≈ 1m / 12m / 6m

  const mom12_1 = Math.exp(p.cum[i - W_SKIP] - p.cum[i - W_12]) - 1;
  const mom6_1  = Math.exp(p.cum[i - W_SKIP] - p.cum[i - W_6]) - 1;
  const rev1m   = roc(p, i, W_SKIP);

  // Convención de ventana (verificada contra un cálculo independiente sobre precios ajustados,
  // 20/20 exactos): `returnsSeries` va DESPLAZADO — ret[j] es el movimiento de dates[j-1] a
  // dates[j] — así que este slice son 253 log-retornos que cubren dates[i-253]→dates[i].
  // Todos los nombres usan la misma convención, que es lo único que el corte transversal exige.
  const win12 = p.ret.slice(i - W_12, i + 1);
  const volAnn = std(win12) * Math.sqrt(252);
  if (!(volAnn > 0)) return null;

  // RS ponderada estilo IBD (40/20/20/20 sobre los cuatro trimestres)
  const q1 = roc(p, i, 63), q2 = roc(p, i, 126), q3 = roc(p, i, 189), q4 = roc(p, i, 252);
  const rsIbd = [q1, q2, q3, q4].every((x) => x != null) ? 0.4 * q1 + 0.2 * q2 + 0.2 * q3 + 0.2 * q4 : null;

  // distancia al máximo de 52 semanas (1 = está en máximos)
  let maxCum = -Infinity;
  for (let k = i - W_12; k <= i; k++) if (p.cum[k] > maxCum) maxCum = p.cum[k];
  const dist52w = Math.exp(p.cum[i] - maxCum);

  // information discreteness (Frog in the Pan) sobre la ventana de formación t-12→t-1
  let pos = 0, neg = 0;
  for (let k = i - W_12 + 1; k <= i - W_SKIP; k++) { if (p.ret[k] > 0) pos++; else if (p.ret[k] < 0) neg++; }
  const nDays = pos + neg;
  const sgn = mom12_1 > 0 ? 1 : mom12_1 < 0 ? -1 : 0;
  const fipId = nDays > 0 ? sgn * (neg / nDays - pos / nDays) : null;

  // momentum residual (Blitz): regresión contra el SPY en la ventana de formación
  let residMom = null;
  if (spyMap) {
    const xs = [], ys = [];
    for (let k = i - W_12 + 1; k <= i - W_SKIP; k++) {
      const m = spyMap.get(p.dates[k]);
      if (m != null) { xs.push(m); ys.push(p.ret[k]); }
    }
    if (xs.length >= 120) {
      const mx = mean(xs), my = mean(ys);
      let cov = 0, vx = 0;
      for (let k = 0; k < xs.length; k++) { cov += (xs[k] - mx) * (ys[k] - my); vx += (xs[k] - mx) ** 2; }
      if (vx > 0) {
        const beta = cov / vx, alpha = my - beta * mx;
        const res = ys.map((y, k) => y - alpha - beta * xs[k]);
        const sd = std(res);
        if (sd > 0) residMom = res.reduce((a, b) => a + b, 0) / (sd * Math.sqrt(res.length));
      }
    }
  }

  return {
    mom12_1: mom12_1 * 100,
    mom12_1_ra: (mom12_1 * 100) / volAnn,
    mom6_1_ra: (mom6_1 * 100) / volAnn,
    rs_ibd: rsIbd != null ? rsIbd * 100 : null,
    dist52w,
    resid_mom: residMom,
    fip_neg: fipId != null ? -fipId : null,   // signo invertido: continuo (ID negativo) = mejor
    rev1m_neg: rev1m != null ? -rev1m * 100 : null, // signo invertido: probamos la REVERSIÓN
    vol_ann: volAnn,
  };
}

/** Percentil transversal (rango medio, 0..1) de una columna dentro de un mes. */
export function pct(rows, key) {
  const v = rows.map((r) => [r.t, r[key]]).filter(([, x]) => x != null && isFinite(x));
  const m = new Map(); const n = v.length; if (n < 8) return m;
  v.sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < n;) { let j = i; while (j < n && v[j][1] === v[i][1]) j++; const p = ((i + j - 1) / 2) / (n - 1); for (let k = i; k < j; k++) m.set(v[k][0], p); i = j; }
  return m;
}
