// ─────────────────────────────────────────────────────────────────────────────
// BETA — estimada como en Frazzini & Pedersen (2014), "Betting Against Beta"
//
// POR QUÉ ESTE MÉTODO Y NO UNA REGRESIÓN A UN AÑO. El artículo estima beta como
//
//     β = ρ · (σ_i / σ_m)
//
// con la CORRELACIÓN sobre cinco años y las VOLATILIDADES sobre uno. No es un capricho: la
// correlación es mucho más estable que la volatilidad, así que estimarlas con ventanas
// distintas da un beta que se mueve por lo que de verdad cambia (el riesgo del valor) y no
// por ruido de muestreo en la correlación. Copiar el método exacto importa porque el
// resultado que se va a contrastar es el del artículo, y medirlo de otra forma haría que un
// desacuerdo fuera imposible de interpretar.
//
// La correlación va sobre retornos SOLAPADOS DE TRES DÍAS. También es del artículo, y su
// razón es la negociación no sincronizada: un valor poco líquido no reacciona el mismo día
// que el índice, y con retornos diarios su beta sale sesgado a la baja.
//
// Y el ENCOGIMIENTO hacia 1 (0,6·β + 0,4) es de Vasicek: un beta estimado con ruido tiende a
// estar demasiado lejos de 1, y encogerlo mejora la predicción del beta futuro. Sin él, los
// extremos de la ordenación serían sobre todo errores de estimación — que es exactamente lo
// que un ranking amplifica.
//
// ⚠️ ESTO NO ES `lowvol`. `quality_lowvol_lab` ordena por volatilidad TOTAL; esto ordena por
// beta, que es la parte de esa volatilidad que va con el mercado. Son cosas distintas y la
// diferencia es el objeto del contraste — ver la puerta previa de `bab_lab.mjs`.
// ─────────────────────────────────────────────────────────────────────────────

/** Ventanas del artículo, en sesiones de mercado. */
export const DIAS_CORR = 1250;   // ~5 años
export const DIAS_VOL = 252;     // ~1 año
export const SOLAPE = 3;         // retornos de 3 días para la correlación
/** Encogimiento de Vasicek hacia el beta de mercado. */
export const PESO_MUESTRA = 0.6;

const media = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/** Suma móvil de `n` días sobre log-retornos: convierte diarios en solapados de n días. */
export function solapados(rets, n = SOLAPE) {
  if (rets.length < n) return [];
  const out = [];
  let s = 0;
  for (let i = 0; i < rets.length; i++) {
    s += rets[i];
    if (i >= n) s -= rets[i - n];
    if (i >= n - 1) out.push(s);
  }
  return out;
}

/** Desviación típica muestral. */
export function desv(a) {
  if (a.length < 2) return null;
  const m = media(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

/** Correlación de Pearson. `null` si alguna serie no varía. */
export function correl(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 30) return null;
  const x = a.slice(a.length - n), y = b.slice(b.length - n);
  const mx = media(x), my = media(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const u = x[i] - mx, v = y[i] - my; num += u * v; dx += u * u; dy += v * v; }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/**
 * Beta de un valor contra el mercado, con los datos disponibles HASTA `hasta` inclusive.
 *
 * `serie` y `mercado` son [{date, ret}] con log-retornos diarios, en orden cronológico. El
 * corte por fecha se hace aquí dentro para que no haya forma de colar información futura por
 * descuido de quien llama.
 */
export function betaAt(serie, mercado, hasta, { minCorr = 500, minVol = 120 } = {}) {
  if (!serie?.length || !mercado?.length) return null;

  // Se alinean por fecha: un día que le falta a uno no puede emparejarse con otro del otro.
  const porFecha = new Map();
  for (const r of mercado) if (r.date <= hasta) porFecha.set(r.date, r.ret);
  const fechas = [], ri = [], rm = [];
  for (const r of serie) {
    if (r.date > hasta) break;
    const m = porFecha.get(r.date);
    if (m == null) continue;
    fechas.push(r.date); ri.push(r.ret); rm.push(m);
  }
  if (ri.length < minCorr) return null;

  const corrI = solapados(ri.slice(-DIAS_CORR));
  const corrM = solapados(rm.slice(-DIAS_CORR));
  const rho = correl(corrI, corrM);
  if (rho == null) return null;

  const volI = desv(ri.slice(-DIAS_VOL));
  const volM = desv(rm.slice(-DIAS_VOL));
  if (volI == null || volM == null || volM === 0 || ri.slice(-DIAS_VOL).length < minVol) return null;

  const bruto = rho * (volI / volM);
  if (!isFinite(bruto)) return null;
  // Encogimiento hacia 1. El artículo usa 0,6/0,4 y aquí se mantiene por lo mismo que las
  // ventanas: para que un desacuerdo con el artículo sea interpretable.
  return PESO_MUESTRA * bruto + (1 - PESO_MUESTRA) * 1;
}
