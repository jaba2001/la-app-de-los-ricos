// ─────────────────────────────────────────────────────────────────────────────
// ¿SE SOSTIENE SOLO UN NIVEL C?
//
// El resolutor de CIK clasifica su evidencia en niveles y deja B y C «a revisar a mano»,
// porque los dos producen CIK **plausibles y equivocados** — Wendy's como dueña de `TWC`, Life
// Storage como dueña del `LSI` de 2010-2014 — y un CIK equivocado es peor que ninguno: entra en
// el backtest con datos de otra empresa y nadie lo nota.
//
// ⚠️ PERO B Y C NO SON LO MISMO, y al mirarlos el 2026-09-01 resultó que **C ya cumplía el listón
// de A**. Son dos evidencias distintas:
//
//   · **B** dice literalmente «FUERA del periodo en el índice»: el símbolo aparece en la tabla de
//     registro del emisor, pero en fechas en que ese emisor NO era el dueño del ticker. Ésa es
//     exactamente la trampa. Sigue necesitando juicio humano.
//
//   · **C** dice que el emisor NOMBRA SU PROPIO DOCUMENTO de la SEC con el ticker como prefijo:
//     `apol-may312013x10q.htm`, `arg-33116form10xk.htm`, `cbs_10k-123118.htm`. Eso no es débil —
//     es la empresa autoidentificándose en un papel que ella misma presenta, y el nombre del
//     fichero lo pone el declarante.
//
// EL CRITERIO, que es el mismo del nivel A: se admite un C **sólo si** (a) el prefijo del
// documento es el ticker de verdad, con un separador detrás para que `A` no case con `apol-…`, y
// (b) el año del documento cae DENTRO del periodo en que ese ticker estuvo en el índice. La
// segunda condición es la que descarta la trampa de B: un documento de 2019 no prueba nada sobre
// quién tenía el ticker en 2012.
//
// Comprobado sobre los 26 del artefacto: prefijo correcto 26/26 y año dentro del periodo 26/26.
// Cero fuera, cero ilegibles.
//
// Vive en su propio módulo, y no dentro de `publicar_resolucion.mjs`, para que el test pueda
// importarlo sin ejecutar el publicador entero.
// ─────────────────────────────────────────────────────────────────────────────

/** Lo que va entre comillas angulares en la comprobación: el nombre del documento. */
export function documentoDe(comprobacion) {
  const m = String(comprobacion ?? "").match(/«([^»]+)»/);
  return m ? m[1] : null;
}

/** El año del informe que cita la comprobación («10-K de 2016»), o null. */
export function anioDelDocumento(comprobacion) {
  const m = String(comprobacion ?? "").match(/10-[KQ] de (\d{4})/);
  return m ? Number(m[1]) : null;
}

/**
 * ¿El nombre del documento empieza por el ticker, como token y no como trozo de palabra?
 *
 * El separador importa: sin él, el ticker `A` casaría con `apol-may312013x10q.htm` y `ARG` con
 * `argan-2015.htm`. Se exige que detrás del prefijo venga algo que no sea una letra.
 */
export function prefijoEsElTicker(doc, ticker) {
  if (!doc || !ticker) return false;
  const d = doc.toLowerCase(), t = ticker.toLowerCase();
  if (!d.startsWith(t)) return false;
  const sig = d[t.length];
  return sig === undefined || !/[a-z]/.test(sig);
}

/**
 * ¿Se sostiene este nivel C sin que lo mire una persona?
 *
 * Devuelve `{ vale, motivo }`. El motivo se publica: una admisión automática tiene que poder
 * explicarse sola, igual que se explica un rechazo.
 */
export function nivelCseSostiene(f) {
  if (f?.evidencia !== "C") return { vale: false, motivo: "no es nivel C" };

  const doc = documentoDe(f.comprobacion);
  if (!doc) return { vale: false, motivo: "la comprobación no cita ningún documento" };
  if (!prefijoEsElTicker(doc, f.ticker)) {
    return { vale: false, motivo: `el documento «${doc}» no empieza por «${f.ticker}» como token` };
  }

  const anio = anioDelDocumento(f.comprobacion);
  if (anio == null) return { vale: false, motivo: `no se lee el año del documento en «${f.comprobacion}»` };

  const desde = Number(String(f.desde ?? "").slice(0, 4));
  const hasta = Number(String(f.hasta ?? "").slice(0, 4));
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) {
    return { vale: false, motivo: "el periodo en el índice no es legible" };
  }
  if (anio < desde || anio > hasta) {
    // Ésta es la condición que separa C de B: un documento fuera del periodo no dice nada sobre
    // quién tenía el ticker DENTRO de él.
    return { vale: false, motivo: `el documento es de ${anio} y el ticker estuvo en el índice ${desde}-${hasta}` };
  }

  return { vale: true, motivo: `el emisor nombra «${doc}» con su propio ticker, y es de ${anio}, dentro de ${desde}-${hasta}` };
}
