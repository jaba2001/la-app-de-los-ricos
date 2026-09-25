// Qué merece una notificación macro, y cuándo.
//
// Estaba inline dentro de app/api/cron/push-alerts/route.js y sin tests, aunque decide lo
// que se envía a TODAS las suscripciones a la vez. Aquí es puro y comprobable.
//
// LO QUE SE AÑADE: el CAMBIO DE RÉGIMEN. El cron detectaba divergencia de amplitud y giro
// a risk-off, pero no que el régimen pasara de expansión a contracción — que es el evento
// macro más importante que produce el motor y el único de este catálogo que ningún
// competidor tiene. Era la ausencia más cara del sistema de alertas.
//
// REGLA DE REDACCIÓN: estado, nunca instrucción. "El régimen ha cambiado a contracción" es
// una observación; "vende" sería asesoramiento. El producto entero se apoya en esa
// distinción, y una notificación es el sitio donde más fácil se rompe.

/** Regímenes conocidos → cómo se dicen. Uno desconocido se muestra tal cual. */
const REGIME_WORDS = {
  expansion: "expansion",
  slowdown: "slowdown",
  contraction: "contraction",
  recovery: "recovery",
  stagflation: "stagflation",
  goldilocks: "goldilocks",
  reflation: "reflation",
  neutral: "neutral",
};

const word = (id) => REGIME_WORDS[id] || id;

/** Normaliza el id de régimen; null si no hay lectura utilizable. */
export function regimeId(m) {
  if (!m) return null;
  const raw = m.regime_id;
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return s || null;
}

/**
 * ¿Ha cambiado el régimen respecto a la última vez que miramos?
 *
 * `prev` null significa que no hay referencia: se SIEMBRA y no se notifica. Sin esto, el
 * primer pase tras desplegar mandaría un "cambio de régimen" a todo el mundo por un
 * régimen que llevaba meses igual.
 */
export function regimeChanged(prev, curr) {
  if (!curr) return false;
  if (!prev) return false;
  return prev !== curr;
}

/**
 * El evento macro que toca notificar, si es que hay alguno.
 *
 * Prioridad: el cambio de régimen manda sobre el resto, porque reconfigura la lectura
 * entera —incluida la de las otras dos alertas—. Si el régimen no ha cambiado, se
 * conserva exactamente la lógica anterior de divergencia y risk-off.
 *
 * @param {object} m fila de macro_state
 * @param {string|null} prevRegime último régimen notificado/observado
 * @returns {{key: string, title?: string, body?: string, regime: string|null}}
 *          `key === "ok"` = no hay nada que enviar. El cron deduplica comparando `key`
 *          con la última enviada, así que la clave lleva el régimen dentro.
 */
export function macroAlertFor(m, prevRegime = null) {
  const curr = regimeId(m);

  if (regimeChanged(prevRegime, curr)) {
    const confirmed = String((m && m.regime_confirmation) || "").toLowerCase() === "confirmed";
    return {
      key: `regime:${curr}`,
      regime: curr,
      title: `Scora — regime moved to ${word(curr)}`,
      // Estado y procedencia, sin instrucción. La confirmación se dice porque un régimen
      // sin confirmar es una lectura provisional y ocultarlo sería vender más certeza de
      // la que hay.
      body: `The macro regime changed from ${word(prevRegime)} to ${word(curr)}${confirmed ? " and is confirmed" : ", not yet confirmed"}. The allocation read on /macro is now built on that regime.`,
    };
  }

  const ro = m && m.risk_on != null ? Number(m.risk_on) : null;
  const bd = m && m.breadth_200dma != null ? Number(m.breadth_200dma) : null;

  // Divergencia: se respeta la confirmación guardada, pero TAMBIÉN se deriva en vivo de la
  // misma fila (risk_on − breadth ≥ 12, el mismo GAP_DIVERGE de lib/regimeLoop.ts) para
  // que la alerta no dependa de qué cron escribió el último.
  const gapDiverges = ro != null && bd != null && ro - bd >= 12;
  if ((m && m.regime_confirmation === "divergent-bearish") || gapDiverges) {
    return {
      key: "divergence",
      regime: curr,
      title: "Scora — breadth divergence",
      body: `Risk-on ${ro != null ? ro.toFixed(0) : "?"} but only ${bd != null ? bd.toFixed(0) : "?"}% of names are above their 200-day. Participation is narrowing — an early warning.`,
    };
  }

  if (ro != null && ro < 40) {
    return {
      key: "risk-off",
      regime: curr,
      title: "Scora — backdrop turned risk-off",
      body: `The liquidity-led risk-on gauge fell to ${ro.toFixed(0)}/100. The validated allocator tilts to duration, gold and cash.`,
    };
  }

  return { key: "ok", regime: curr };
}
