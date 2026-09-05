// Evaluación de los kinds de alerta que hasta ahora eran "solo in-app".
//
// `sl_alerts` declara siete kinds, pero el cron solo evaluaba cinco: `rating_buy` y
// `rdcf_cheap` se creaban desde la UI y nunca mandaban push (la migración de sl_alerts lo
// documenta como "the in-app UI also evaluates rating_buy / rdcf_cheap live"). El efecto
// para el usuario es una notificación prometida que no llega, así que aquí se cierran.
//
// Clave del diseño: NO hace falta recalcular fundamentales. `sl_analyses` ya guarda
// `rating`, `macro_tilt` y el snapshot `reverse_dcf` por usuario+ticker cada vez que se
// analiza. El cron solo lee esa tabla — cero llamadas a FMP para estos dos kinds.
//
// Todo lo de aquí es puro y sin red: se prueba en scripts/alertkinds.test.mjs.

/** Códigos ordinales de rating. Hay DOS vocabularios vivos en el producto:
 *  `getRating()` (el que se persiste en sl_analyses): STRONG BUY / BUY / CAUTION / AVOID
 *  `ratingFrom()` (el del verdict): Strong Buy / Buy / Sell / Strong Sell
 *  Se aceptan los dos para que un cambio de vocabulario no apague las alertas en silencio. */
const RATING_CODES = [
  [/^strong\s*buy$/i, 4],
  [/^buy$/i, 3],
  [/^(caution|sell)$/i, 2],
  [/^(avoid|strong\s*sell)$/i, 1],
];

/** Rating → 1..4, o null si no se reconoce. Nunca lanza. */
export function ratingCode(label) {
  if (typeof label !== "string") return null;
  const s = label.trim();
  if (!s) return null;
  for (const [re, code] of RATING_CODES) if (re.test(s)) return code;
  // Último recurso: cualquier etiqueta que contenga "buy" cuenta como comprador, que es
  // exactamente lo que hace la UI (/buy/i). Preferimos disparar de más que perder la señal.
  return /buy/i.test(s) ? 3 : null;
}

/** Umbral a partir del cual consideramos "territorio comprador". */
export const BUY_CODE = 3;

/**
 * ¿Ha CRUZADO a comprador? Se dispara en la transición, no mientras siga siéndolo — si no,
 * una acción bien puntuada notificaría cada 24h para siempre.
 *
 * `prev` null significa que aún no hay referencia: se siembra y NO se dispara. Es lo mismo
 * que hace `stage_change` y evita una avalancha de notificaciones el primer día.
 */
export function ratingBuyTriggered(prev, curr) {
  if (curr == null || curr < BUY_CODE) return false;
  if (prev == null) return false;          // primera lectura: sembrar, no disparar
  return prev < BUY_CODE;                  // estaba fuera y ha entrado
}

/** Upside del snapshot reverse-DCF. Tolera el JSON como objeto o como texto. */
export function rdcfUpside(snapshot) {
  if (snapshot == null) return null;
  let o = snapshot;
  if (typeof o === "string") {
    try { o = JSON.parse(o); } catch { return null; }
  }
  if (typeof o !== "object") return null;
  const v = Number(o.upside);
  return Number.isFinite(v) ? v : null;
}

/** ¿Ha pasado el upside a positivo? Misma regla de transición que `ratingBuyTriggered`. */
export function rdcfCheapTriggered(prev, curr) {
  if (curr == null || !(curr > 0)) return false;
  if (prev == null) return false;          // primera lectura: sembrar, no disparar
  return prev <= 0;
}

/**
 * ¿Es el análisis lo bastante reciente como para justificar una notificación?
 *
 * `sl_analyses` solo se actualiza cuando el usuario analiza el ticker. Sin este filtro, un
 * análisis de hace meses podría disparar hoy una alerta sobre datos muertos — que es
 * exactamente el tipo de "señal" que este producto no quiere emitir.
 */
export function isFresh(analysisDate, now = Date.now(), maxAgeDays = 7) {
  if (!analysisDate) return false;
  const t = Date.parse(typeof analysisDate === "string" ? analysisDate : String(analysisDate));
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  if (age < 0) return true;                // fecha futura (zona horaria): trátala como fresca
  return age <= maxAgeDays * 86400000;
}

/**
 * Decide una alerta de las que se resuelven contra `sl_analyses`.
 * Devuelve `{ fire, nextValue, detail }`; `nextValue` es lo que se guarda en `last_value`
 * para poder detectar la próxima transición (se persiste dispare o no).
 */
export function evaluateAnalysisAlert(kind, alert, analysis, now = Date.now()) {
  const prev = alert && alert.last_value != null ? Number(alert.last_value) : null;

  if (!analysis || !isFresh(analysis.analysis_date, now)) {
    return { fire: false, nextValue: null, detail: "no fresh analysis" };
  }

  if (kind === "rating_buy") {
    const curr = ratingCode(analysis.rating);
    return {
      fire: ratingBuyTriggered(prev, curr),
      nextValue: curr,
      detail: `turned ${String(analysis.rating || "").toLowerCase()}`,
    };
  }

  if (kind === "rdcf_cheap") {
    const curr = rdcfUpside(analysis.reverse_dcf);
    return {
      fire: rdcfCheapTriggered(prev, curr),
      nextValue: curr,
      detail: curr == null ? "" : `reverse-DCF upside turned positive (${curr.toFixed(1)}%)`,
    };
  }

  return { fire: false, nextValue: null, detail: "unknown kind" };
}

/** Kinds que se resuelven leyendo sl_analyses (sin llamadas externas). */
export const ANALYSIS_KINDS = ["rating_buy", "rdcf_cheap"];
