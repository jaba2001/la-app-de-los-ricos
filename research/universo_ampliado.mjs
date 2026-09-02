// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSO AMPLIADO — macro fija el presupuesto, micro elige el activo
//
// La petición: que la señal recorra TODO —ETFs, bonos, materias primas, oro, petróleo,
// cripto— y diga «ahora oro, ahora bitcoin». El allocator de producción ya va de macro a
// micro, pero su micro sólo puede elegir entre SIETE cosas: SPY, TLT, IEF, GLD, DBC, BIL y
// BTCUSD. Aquí se amplía a ~25 sin añadir un solo parámetro de régimen.
//
// ⚠️ **LAS DOS FORMAS DE AMPLIAR, Y POR QUÉ SÓLO UNA ES DEFENDIBLE.**
//
//   ❌ Extender `REGIME_WEIGHTS` a mano. Cinco regímenes × 25 activos son 125 números que
//      elegiría yo mirando la misma historia con la que luego se mide. CAIA lo dice sin
//      rodeos: «models with fewer parameters tend to fit future data better». Es la receta
//      exacta de un backtest precioso que muere en producción.
//
//   ✅ **Dejar el macro EXACTAMENTE como está y ampliar sólo dentro de cada clase.** El
//      régimen sigue decidiendo CUÁNTO va a renta variable, a duración, a oro, a materias
//      primas y a caja —los pesos ya validados, sin tocar uno—; dentro de cada clase, el
//      momento relativo decide CUÁL. **Cero parámetros de régimen nuevos.**
//
// Y es justo lo que se pedía: dentro de metales puede elegir plata en vez de oro; dentro de
// materias primas, petróleo o agrícolas; dentro de renta variable, Nasdaq o emergentes. La
// señal se vuelve concreta sin que nadie haya escrito «en estanflación, 12 % de petróleo».
//
// EL ÚNICO PARÁMETRO NUEVO es `k`: cuántos activos se tienen por clase. Se miden k=1 y k=2 y
// **se publican los dos**, gane el que gane — CAIA llama cherry-picking a lo contrario.
//
//   node --experimental-strip-types --no-warnings research/universo_ampliado.mjs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El universo, agrupado por la MISMA clase que el régimen ya conoce.
 *
 * `base` es el activo que usa hoy producción: se conserva para que la comparación sea limpia
 * —si `k=1` eligiera siempre la base, el resultado tendría que ser idéntico al actual, y eso
 * es una comprobación, no una casualidad—.
 *
 * ⚠️ `desde` es la fecha REAL en que cada serie empieza, medida el 2026-09-03 con
 * `PX_FROM=2004-01-01 PX_REFRESH=1`. No es decorativa: un activo no puede entrar en la
 * selección antes de existir, y confiar en «lo que el caché tenga» fue exactamente lo que
 * infló el resultado del sleeve de BTC de +637 % a +740 %.
 */
export const CLASES = {
  equity: {
    base: "SPY",
    miembros: [
      { t: "SPY", desde: "2006-01-03", nombre: "S&P 500" },
      { t: "QQQ", desde: "2004-01-02", nombre: "Nasdaq 100" },
      { t: "IWM", desde: "2004-01-02", nombre: "Small caps US" },
      { t: "MDY", desde: "2004-01-02", nombre: "Mid caps US" },
      { t: "EFA", desde: "2004-01-02", nombre: "Desarrollados ex-US" },
      { t: "EEM", desde: "2004-01-02", nombre: "Emergentes" },
      { t: "EWJ", desde: "2004-01-02", nombre: "Japón" },
    ],
  },
  duracion: {
    base: "TLT",
    miembros: [
      { t: "TLT", desde: "2006-01-03", nombre: "Treasuries 20+ años" },
      { t: "IEF", desde: "2006-01-03", nombre: "Treasuries 7-10 años" },
      { t: "SHY", desde: "2004-01-02", nombre: "Treasuries 1-3 años" },
      { t: "TIP", desde: "2004-01-02", nombre: "Ligados a inflación" },
    ],
  },
  credito: {
    base: "LQD",
    miembros: [
      { t: "LQD", desde: "2004-01-02", nombre: "Corporativo grado inversión" },
      { t: "HYG", desde: "2007-04-11", nombre: "Alto rendimiento" },
      { t: "EMB", desde: "2007-12-19", nombre: "Deuda emergente" },
    ],
  },
  metales: {
    base: "GLD",
    miembros: [
      { t: "GLD", desde: "2006-01-03", nombre: "Oro" },
      { t: "SLV", desde: "2006-04-28", nombre: "Plata" },
      { t: "PPLT", desde: "2010-01-08", nombre: "Platino" },
    ],
  },
  materias: {
    base: "DBC",
    miembros: [
      { t: "DBC", desde: "2006-02-06", nombre: "Materias primas amplio" },
      { t: "USO", desde: "2006-04-10", nombre: "Petróleo" },
      { t: "DBA", desde: "2007-01-05", nombre: "Agrícolas" },
      { t: "UNG", desde: "2007-04-18", nombre: "Gas natural" },
    ],
  },
  inmobiliario: {
    base: "VNQ",
    miembros: [
      { t: "VNQ", desde: "2004-09-29", nombre: "REITs US" },
      { t: "IYR", desde: "2004-01-02", nombre: "Inmobiliario US" },
    ],
  },
  cripto: {
    base: "BTCUSD",
    miembros: [
      // ⚠️ La fecha NO es la del dato (2014-09) sino la que se declaró invertible para un
      // particular. Cambiarla es una decisión de producto, no un efecto de refrescar precios.
      { t: "BTCUSD", desde: "2018-06-01", nombre: "Bitcoin" },
      { t: "ETHUSD", desde: "2018-06-01", nombre: "Ethereum" },
    ],
  },
  caja: {
    base: "BIL",
    miembros: [
      { t: "BIL", desde: "2007-05-30", nombre: "Letras del Tesoro" },
      { t: "SHV", desde: "2007-01-11", nombre: "Tesoro ≤1 año" },
    ],
  },
};

/**
 * Qué clase alimenta cada peso del régimen.
 *
 * El régimen de producción reparte entre SPY, TLT, IEF, GLD, DBC y BIL. Aquí cada uno de esos
 * pesos se convierte en el presupuesto de SU CLASE, sin cambiar el número. `IEF` es el único
 * caso especial: en producción es lastre de duración aparte de `TLT`, así que se le deja su
 * propio presupuesto y se sirve desde la misma clase.
 *
 * ⚠️ `credito` e `inmobiliario` NO reciben presupuesto en esta versión. Dárselo obligaría a
 * inventar cinco números nuevos —uno por régimen— que nadie ha validado, y ése es justo el
 * camino que este fichero existe para no tomar. Entran cuando haya una hipótesis propia que
 * los justifique, medida aparte.
 */
export const PESO_A_CLASE = {
  SPY: "equity",
  TLT: "duracion",
  IEF: "duracion",
  GLD: "metales",
  DBC: "materias",
  BIL: "caja",
};

/** Todos los tickers que el universo ampliado puede llegar a tener. */
export function tickersAmpliados() {
  const out = new Set();
  for (const [clase, def] of Object.entries(CLASES)) {
    if (![...Object.values(PESO_A_CLASE)].includes(clase)) continue;   // sin presupuesto: no se usa
    for (const m of def.miembros) out.add(m.t);
  }
  return [...out];
}

/**
 * Elige los `k` mejores de una clase por momento relativo, respetando la fecha de alta.
 *
 * Devuelve `[]` si ninguno está disponible o ninguno tiene momento calculable — y eso NO es lo
 * mismo que «ninguno vale»: quien llame tiene que decidir qué hacer con un presupuesto que no
 * se puede colocar (en el laboratorio va a caja, que es lo que hace el momento absoluto).
 */
export function mejoresDeClase(clase, fecha, momentos, k = 1) {
  const def = CLASES[clase];
  if (!def) return [];
  return def.miembros
    .filter((m) => fecha >= m.desde)
    .map((m) => ({ t: m.t, mom: momentos[m.t] }))
    .filter((x) => x.mom != null && Number.isFinite(x.mom))
    .sort((a, b) => b.mom - a.mom)
    .slice(0, k)
    .map((x) => x.t);
}
