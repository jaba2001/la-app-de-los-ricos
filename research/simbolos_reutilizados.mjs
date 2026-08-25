// ─────────────────────────────────────────────────────────────────────────────
// SÍMBOLOS REUTILIZADOS — el segundo tramo del sesgo de supervivencia
//
// Resolver el CIK de las empresas muertas les devuelve los FUNDAMENTALES. Pero un backtest
// necesita además PRECIOS, y ahí aparece un fallo distinto y peor, porque no da error:
//
//   Cuando una empresa desaparece, su símbolo queda libre y **otro instrumento lo hereda**.
//   Los proveedores indexan por símbolo, así que devuelven 200 y una serie larga y continua…
//   de otra cosa. Medido el 2026-08-24 contra las dos fuentes de este repositorio:
//
//     · `GENZ` — Genzyme fue comprada por Sanofi a **74 $/acción** en abril de 2011. Yahoo y
//       Tiingo devuelven **4.437 barras de 2009 a 2026** y un cierre de **32,99 $** el día de
//       la operación: es el *VanEck Digital Native Economy ETF*. No es un empalme —no hay
//       ninguna discontinuidad, su mayor salto diario es un −14 % el 16-03-2020, un día de
//       COVID—, así que **truncar no sirve**: el tramo viejo tampoco es de Genzyme.
//     · `FB` — Meta sólo cambió de símbolo, pero `FB` es hoy un ETF de ProShares que cotiza
//       desde junio de 2025. Ni una sola barra de Meta.
//     · `TWX` — hoy un fondo de inversión llamado «17007297» en Yahoo. Tiingo sí devuelve la
//       serie correcta de Time Warner, que termina el día de la compra por AT&T.
//     · `ESRX` — igual: Yahoo da un fondo, Tiingo da Express Scripts hasta el 2018-12-20.
//
// El fenómeno ya estaba anotado: `SCORA_PICKS_REGLAS.md` registró el 2026-08-21 que Tiingo
// reciclaba cinco tickers (`FB`, `INFO`, `NFX`…). Lo que faltaba es que Yahoo hace lo mismo, y
// sobre todo que **la variante peligrosa no es la que se vio entonces**: aquellas cinco se
// delataban porque su serie EMPIEZA tarde. `GENZ` no — son 4.437 barras continuas de 2009 a
// 2026, sin un hueco—, así que pasa cualquier comprobación de «empieza cuando debe». A ésa la
// delata la fecha en que TERMINA, que es la prueba de abajo.
//
// TRES PRUEBAS, y no pesan lo mismo — la diferencia costó tres pasadas en falso:
//
//   · **DIRECTA** · el proveedor dice qué es el instrumento, y un ETF o un fondo nunca fue
//     miembro del S&P 500. Basta por sí sola.
//   · **CIRCUNSTANCIAL — solape** · la serie no cubre ni un día del periodo en el índice.
//   · **CIRCUNSTANCIAL — cola** · la empresa dejó de presentar informes al salir del índice
//     y sin embargo la serie sigue cotizando cientos de días más.
//
// Las circunstanciales dicen que ESTA respuesta no sirve, no que no exista una buena, así que
// sólo bloquean si se pudo preguntar a los DOS proveedores. Lo enseñó `EA`: Yahoo devuelve un
// muñón de seis semanas de 2026 —«no solapa»— mientras Tiingo, que tiene sus quince años de
// historia, estaba sin consultar porque se había agotado la cuota. Bloquear ahí habría borrado
// del backtest un nombre impecable.
//
// Y dos trampas más, las dos encontradas midiendo:
//
//   · **Salir del índice no es morir.** BorgWarner (`BWA`) salió del S&P 500 y sigue cotizando.
//     La prueba de la cola sólo vale si la empresa DEJÓ DE PRESENTAR informes, y eso hay que
//     mirarlo en EDGAR: el mapa de símbolos de la SEC suelta el ticker de empresas vivas —`K`,
//     `DFS`, `HES`, `XOM`—, y usarlo como certificado de defunción marcó a Comerica.
//   · **Agotar la cuota se parece a «no hay datos».** La primera pasada completa dio 141 «sin
//     datos» que incluían `XLNX`, `RTN`, `TWX` y `ESRX`, resueltos sin problema minutos antes.
//     Ahora el 429 se distingue, se marca «no comprobado», y un bloqueo anterior **se hereda**
//     en vez de levantarse solo por no haber podido mirar.
//
// Lo que salga marcado aquí se BLOQUEA en `prices.mjs` y `pricesLong.mjs`: es preferible que
// un nombre no tenga precios —y quede fuera, contado y a la vista— a que tenga los de otro.
//
//   node research/simbolos_reutilizados.mjs [--solo TICKER,TICKER] [--rehacer]
//
// Es INCREMENTAL: hereda los veredictos firmes de la pasada anterior y sólo pregunta por los
// que quedaron sin comprobar, así que hay que correrlo varias veces —una por hora— hasta que
// no queden «no comprobados». `--rehacer` lo fuerza todo de cero.
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical } from "./universe.mjs";
import { YAHOO_ALIAS } from "./prices.mjs";
import { tickerToCik } from "./edgar.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(AQUI, "out");
const DATA = join(AQUI, "data");
for (const d of [OUT, DATA]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

const HOY = new Date().toISOString().slice(0, 10);
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" };
const TOK = process.env.TIINGO_TOKEN || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dias = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

/**
 * VERSIÓN DE LAS REGLAS. Súbela cuando cambie CUALQUIER criterio de `juzgar` o de la decisión.
 *
 * El modo incremental hereda los veredictos firmes de la pasada anterior, y eso es una trampa
 * en cuanto las reglas cambian: la primera auditoría marcó `CMA`, `ANSS` y `EA` como
 * suplantados con una regla que después resultó equivocada, y la siguiente pasada los HEREDÓ
 * sin volver a mirarlos. Con esto, un cambio de versión invalida la herencia y obliga a
 * recalcular todo — que es lo correcto, aunque cueste otra tanda de cuota.
 *
 *   1 · primera versión (salir del índice = morir; sin distinguir cuota de «sin datos»)
 *   2 · vida por informes de EDGAR, 429 distinguido, prueba directa vs circunstancial
 *   3 · «no se pudo saber si siguió viva» deja de contar como «murió» (ver `ultimoInforme`)
 */
const VERSION_REGLAS = 3;

/** Cuánto puede sobrevivir la serie a la salida del índice antes de ser sospechosa. */
const GRACIA_DIAS = 400; // 12 meses de retorno futuro + holgura para el cierre de la operación
/**
 * Un miembro del índice es una acción ordinaria. Si el proveedor dice otra cosa, es otra cosa.
 *
 * ⚠️ PERO EL PROVEEDOR CAMBIA DE OPINIÓN. El 2026-08-25, con media hora de diferencia, Yahoo
 * devolvió para `GENZ` primero `instrumentType: "ETF"` y luego `"EQUITY"` — con el mismo
 * `longName`, «VanEck Digital Native Economy ETF», en las dos. O sea que la prueba MÁS FUERTE,
 * la única que bloquea ella sola, no es estable en el tiempo.
 *
 * No se compensa mirando el nombre: «Trust» y «Fund» salen en nombres de empresas de verdad
 * (Northern Trust es un miembro del índice), y un falso positivo aquí borra una empresa buena.
 * Lo que compensa es que el bloqueo sea PEGAJOSO dentro de una misma versión de reglas: una vez
 * identificado, se hereda mientras nadie traiga un «ok» de verdad. Y que un símbolo que pierde
 * esta prueba casi siempre conserva la de la cola — `GENZ` la tiene: Genzyme dejó de presentar
 * informes el 2011-03-24, justo al salir del índice.
 *
 * Si un día la lista de bloqueos ENCOGE sin que nadie haya tocado nada, mira aquí antes que a
 * ningún otro sitio: lo más probable es que Yahoo haya vuelto a cambiar de etiqueta.
 */
const NO_ES_ACCION = /^(ETF|MUTUALFUND|INDEX|CURRENCY|CRYPTOCURRENCY|FUTURE)$/i;

async function deYahoo(t) {
  const p1 = Math.floor(new Date("2009-01-01").getTime() / 1000);
  const p2 = Math.floor(Date.now() / 1000);
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?period1=${p1}&period2=${p2}&interval=1d`, { headers: UA });
      if (r.status === 429) { await sleep(1500 * (a + 1)); continue; }
      if (r.status === 404) return { estado: 404 };
      const res = (await r.json())?.chart?.result?.[0];
      const ts = res?.timestamp ?? [];
      if (!ts.length) return { estado: r.status };
      return {
        estado: 200,
        tipo: res?.meta?.instrumentType ?? "",
        nombre: res?.meta?.longName ?? res?.meta?.shortName ?? "",
        desde: new Date(ts[0] * 1000).toISOString().slice(0, 10),
        hasta: new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10),
        barras: ts.length,
      };
    } catch { await sleep(600); }
  }
  return { estado: "red" };
}

/**
 * ⚠️ TIINGO TIENE CUOTA, Y AGOTARLA NO SE PARECE A UN ERROR: se parece a «esta empresa no
 * tiene datos». La primera pasada completa dio **141 «sin datos»** que incluían `XLNX`, `RTN`,
 * `TWX` y `ESRX` — los mismos que minutos antes habían resuelto perfectamente en la prueba
 * corta. No faltaban datos: faltaba cuota. Por eso el 429/403 se distingue del 200-vacío y se
 * marca «no comprobado», que NO permite bloquear a nadie.
 */
// ⚠️ CUANDO LA CUOTA SE AGOTA, DEJA DE PREGUNTAR. No es un fallo transitorio: dura hasta que
// pasa la hora. Con cuatro reintentos escalonados por ticker eso son cincuenta segundos de
// espera **por nombre**, y una pasada de 287 se convierte en cuatro horas para no averiguar
// nada. En cuanto dos tickers seguidos devuelven 429, se marca el resto «no comprobado» de
// inmediato y la pasada termina en minutos — que es exactamente lo que se quiere para poder
// volver a intentarlo cuando la cuota se recupere.
let cuotaAgotada = 0;
async function deTiingo(t) {
  if (!TOK) return { estado: "sin token" };
  if (cuotaAgotada >= 2) return { estado: "cuota" };
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(t)}/prices?startDate=2009-01-01&endDate=${HOY}&format=json&token=${TOK}`, { headers: { "Content-Type": "application/json" } });
      if (r.status === 429 || r.status === 403) { cuotaAgotada++; await sleep(1500); continue; }
      cuotaAgotada = 0;
      if (!r.ok) return { estado: r.status };
      const j = await r.json();
      if (!Array.isArray(j) || !j.length) return { estado: 200, barras: 0 };
      // Se conservan las barras, no sólo las fechas: ver `guardarEnCache`.
      const serie = j.filter((x) => x?.date && x.close != null)
        .map((x) => ({ date: x.date.slice(0, 10), raw: x.close, adj: x.adjClose ?? x.close }))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!serie.length) return { estado: 200, barras: 0 };
      return { estado: 200, desde: serie[0].date, hasta: serie[serie.length - 1].date, barras: serie.length, serie };
    } catch { await sleep(1500); }
  }
  return { estado: "cuota" };
}

/**
 * GUARDAR LO QUE YA SE HA PAGADO.
 *
 * Tiingo permite ~50 peticiones POR HORA en el tramo gratuito, y los ~150 nombres muertos que
 * el backtest necesita son justo los que Yahoo responde con 404. Si esta auditoría consulta la
 * serie y luego se queda sólo con las fechas, el backtest tendrá que volver a pedir lo mismo:
 * seis horas de espera en vez de tres. Así que lo que se descarga se escribe en las mismas
 * cachés que leen `prices.mjs` y `pricesLong.mjs`, en su formato.
 *
 * Sólo se guarda lo que ha salido «ok»: una serie que resultó ser de otro instrumento no se
 * escribe en ninguna parte, se borra (ver el final del fichero).
 */
function guardarEnCache(ticker, serie) {
  if (!serie?.length) return 0;
  let n = 0;
  const limpio = ticker.replace(/[^A-Za-z0-9_.-]/g, "");
  for (const d of ["px", "px_long"]) {
    const dir = join(AQUI, ".cache", d);
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const p = join(dir, `${limpio}.json`);
      // Nunca se pisa una caché existente: podría ser más larga que ésta, y en este repositorio
      // un refresco que ACORTA ya destruyó datos una vez (`EA`, 6 barras, 2026-08-21).
      if (existsSync(p)) continue;
      writeFileSync(p, JSON.stringify(serie));
      n++;
    } catch { /* si no se puede escribir, el backtest lo volverá a pedir y ya está */ }
  }
  return n;
}

/**
 * ¿SIGUIÓ LA EMPRESA SIENDO PÚBLICA DESPUÉS DE SALIR DEL ÍNDICE?
 *
 * Es la pregunta que decide si una serie que continúa años más allá es legítima o es de otro.
 * Y la respuesta tiene que salir de los INFORMES, no del mapa de símbolos de la SEC: ese mapa
 * suelta el ticker de empresas que siguen vivas y presentando —le pasa a `K`, `DFS`, `HES` y
 * `XOM`, que por eso están fijados a mano en `edgar.mjs`—, así que usarlo como prueba de
 * defunción marcó a **Comerica (`CMA`)** como símbolo suplantado cuando lo único que ocurrió
 * es que salió del S&P 500 en 2024 y siguió cotizando.
 *
 * ⚠️ DEVUELVE TRES ESTADOS, NO DOS, y colapsarlos bloqueó a Avon por error.
 *
 * La primera versión devolvía «la fecha, o null si no se puede saber», y quien llamaba hacía
 * `informe != null && …` — con lo que **«no he podido mirar» acababa valiendo «murió»**. Y no
 * se puede mirar precisamente en los tickers cuyo CIK no se ha resuelto, que son los que más
 * necesitan el beneficio de la duda: `AVP` no está entre los 121, así que `tickerToCik`
 * devolvía null, nadie llegó a preguntarle a EDGAR, y la auditoría lo bloqueó afirmando que
 * «dejó de presentar informes al salir del índice». **Avon presentó informes hasta 2023-05-15**,
 * ocho años después de salir, y siguió cotizando hasta que Natura la compró: su serie larga era
 * legítima. Es el defecto nº 7 de §10.3 —confundir «no he podido mirar» con «no hay nada»—
 * reaparecido en la prueba de vida en vez de en la de precios, y aquí era peor, porque el motivo
 * que se escribía en el fichero AFIRMABA un hecho de EDGAR que nadie había observado.
 *
 * Devuelve `{ conocido: false }` cuando no se pudo averiguar, y `{ conocido: true, ultimo }`
 * cuando sí — con `ultimo` en null si de verdad no hay ningún informe periódico.
 */
async function ultimoInforme(ticker) {
  let cik = null;
  try { cik = await tickerToCik(ticker); } catch { return { conocido: false }; }
  if (!cik) return { conocido: false };
  try {
    const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": "Scora Research contact@scora.app" } });
    if (!r.ok) return { conocido: false };
    const f = (await r.json())?.filings?.recent ?? {};
    let max = null;
    for (let i = 0; i < (f.filingDate?.length ?? 0); i++) {
      if (!/^(10-K|10-Q|20-F|40-F)/.test(f.form[i] ?? "")) continue;
      if (!max || f.filingDate[i] > max) max = f.filingDate[i];
    }
    return { conocido: true, ultimo: max };
  } catch { return { conocido: false }; }
}

/**
 * El veredicto, dado lo que dice un proveedor y cuándo estuvo el ticker en el índice.
 *
 * ⚠️ `vivoHoy` NO es un detalle. La primera versión de esto daba por supuesto que salir del
 * índice equivale a morir, y no es así: **BorgWarner (`BWA`) salió del S&P 500 y sigue
 * cotizando**, así que su serie llega legítimamente hasta hoy. La cola sólo tiene sentido
 * cuando la empresa DEJÓ DE PRESENTAR informes al poco de salir.
 */
function juzgar(s, desde, hasta, vivoHoy) {
  // «No he podido mirar» no es «no hay nada», y confundirlos bloquea o absuelve por accidente.
  if (s?.estado === "cuota" || s?.estado === "red") return { veredicto: "no comprobado", motivo: `el proveedor no contestó (${s.estado})` };
  if (!s || s.estado !== 200 || !s.barras) return { veredicto: "sin datos", motivo: `el proveedor no devuelve serie (${s?.estado ?? "?"})` };
  // PRUEBA DIRECTA: el proveedor dice qué es el instrumento, y un ETF nunca fue miembro del
  // S&P 500. Vale por sí sola, aunque el otro proveedor no se haya podido consultar.
  if (s.tipo && NO_ES_ACCION.test(s.tipo)) return { veredicto: "reutilizado", prueba: "tipo", motivo: `el proveedor devuelve un ${s.tipo}${s.nombre ? ` («${s.nombre}»)` : ""}, no una acción` };
  // PRUEBAS CIRCUNSTANCIALES: dicen que ESTA respuesta no sirve, no que no exista una buena.
  if (s.hasta < desde || s.desde > hasta) return { veredicto: "reutilizado", prueba: "solape", motivo: `la serie (${s.desde}→${s.hasta}) no solapa con el periodo en el índice (${desde}→${hasta})` };
  const cola = dias(hasta, s.hasta);
  if (cola > GRACIA_DIAS) {
    // `vivoHoy` es TRI-ESTADO: true (siguió presentando), false (dejó de presentar, y consta en
    // EDGAR), null (no se pudo saber). Sólo el false autoriza a bloquear. El null es la duda, y
    // la duda no borra un nombre del backtest: lo deja pendiente de que alguien pueda mirarlo.
    if (vivoHoy === false) return { veredicto: "reutilizado", prueba: "cola", motivo: `dejó de presentar informes al salir del índice y la serie sigue ${cola} días más (tope ${GRACIA_DIAS})` };
    if (vivoHoy == null) return { veredicto: "no comprobado", prueba: "cola", motivo: `la serie sigue ${cola} días tras salir del índice (tope ${GRACIA_DIAS}), pero NO se pudo comprobar si la empresa siguió presentando informes — sin CIK resuelto, o EDGAR no contestó` };
  }
  return { veredicto: "ok", prueba: null, motivo: `${s.barras} barras, ${s.desde}→${s.hasta}` };
}

// ── Universo a auditar ────────────────────────────────────────────────────────────────────
const table = await loadSP500Historical();
if (!table) { console.error("  ✖ sin tabla de miembros"); process.exit(1); }
const primera = new Map(), ultima = new Map();
for (const f of table) {
  if (f.date < "2010-01-01") continue;
  for (const t of f.tickers) { if (!primera.has(t)) primera.set(t, f.date); ultima.set(t, f.date); }
}
// Sólo interesan los que SALIERON del índice: un miembro actual tiene, por definición, una
// serie que llega a hoy y no puede estar suplantado.
const fin = [...ultima.entries()].map(([, d]) => d).sort();
const ULTIMA_FOTO = fin[fin.length - 1];
let auditar = [...primera.keys()].filter((t) => ultima.get(t) < ULTIMA_FOTO).sort();
// `--solo` para depurar sobre casos concretos; en ese modo NO se escribe nada, para no dejar
// un bloqueo parcial que parezca la auditoría completa.
const iSolo = process.argv.indexOf("--solo");
const SOLO = iSolo > 0 ? new Set(process.argv[iSolo + 1].split(",").map((x) => x.trim().toUpperCase())) : null;
if (SOLO) auditar = auditar.filter((t) => SOLO.has(t));

/**
 * INCREMENTAL, y no por comodidad: sin esto la auditoría no termina nunca.
 *
 * Tiingo da ~50 peticiones por hora, y los tickers muertos son justo los que Yahoo responde
 * con 404, así que casi todos acaban preguntándole a Tiingo. Una pasada sobre 288 nombres
 * agota la cuota a la sexta parte del camino y el resto sale «no comprobado»; la siguiente
 * pasada volvería a empezar por el principio y se quedaría en el mismo sitio.
 *
 * Así que lo ya resuelto —«ok» o «reutilizado», que son respuestas de verdad— se hereda del
 * fichero de evidencia anterior y no se vuelve a preguntar. Cada pasada avanza 50 nombres.
 * `--rehacer` fuerza la auditoría completa cuando hace falta rehacerla de cero.
 */
const REHACER = process.argv.includes("--rehacer");
const previoDetalle = new Map();
if (!REHACER && !SOLO) {
  try {
    const p = join(OUT, "simbolos_reutilizados.json");
    if (existsSync(p)) {
      const prev = JSON.parse(readFileSync(p, "utf8"));
      if ((prev.versionReglas ?? 0) !== VERSION_REGLAS) {
        console.log(`  ⚠ la evidencia anterior se hizo con las reglas v${prev.versionReglas ?? 0} y ahora van por la v${VERSION_REGLAS}: NO se hereda nada, se audita todo de nuevo.`);
      } else {
        for (const f of prev.detalle ?? []) {
          if (f.veredicto === "ok" || f.veredicto === "reutilizado") previoDetalle.set(f.ticker, f);
        }
      }
    }
  } catch { /* sin fichero previo, se audita todo */ }
}

console.log(`\n  ${auditar.length} tickers que salieron del índice desde 2010 (la última foto es ${ULTIMA_FOTO})`);
if (previoDetalle.size) console.log(`  ${previoDetalle.size} ya tenían veredicto firme y se heredan sin volver a preguntar (--rehacer para forzarlo todo)`);
console.log(`  Tiingo: ${TOK ? "con token" : "SIN TOKEN — sólo se podrá comprobar Yahoo"}\n`);

const filas = [];
let n = 0, enCache = 0;
for (const t of auditar) {
  n++;
  const desde = primera.get(t), hasta = ultima.get(t);
  const heredado = previoDetalle.get(t);
  if (heredado) {
    filas.push(heredado);
    process.stdout.write(`
  ${String(n).padStart(3)}/${auditar.length}  ${t.padEnd(8)} ${String(heredado.veredicto).padEnd(12)} (heredado de la pasada anterior)${" ".repeat(20)}`);
    continue;
  }
  const y = YAHOO_ALIAS[t] ?? t;
  // ¿Siguió presentando informes tras salir del índice? Si sí, la empresa seguía siendo
  // pública y su serie puede llegar hasta hoy sin que eso tenga nada de sospechoso.
  const informe = await ultimoInforme(t);
  // null = «no se ha podido saber». NO es lo mismo que false, y colapsarlos bloqueó a Avon.
  const vivo = !informe.conocido ? null : (informe.ultimo != null && dias(hasta, informe.ultimo) > GRACIA_DIAS);
  await sleep(260);
  const sy = await deYahoo(y);
  const jy = juzgar(sy, desde, hasta, vivo);
  // Sólo se molesta a Tiingo cuando Yahoo no sirve o miente: tiene cuota y Yahoo no.
  let st = null, jt = null;
  if (jy.veredicto !== "ok") { await sleep(400); st = await deTiingo(y); jt = juzgar(st, desde, hasta, vivo); }

  const bueno = jy.veredicto === "ok" ? "yahoo" : jt?.veredicto === "ok" ? "tiingo" : null;
  // Manda el proveedor que DECIDIÓ, no siempre Yahoo: si Yahoo no conoce el símbolo y Tiingo
  // devuelve una serie ajena, el motivo que hay que leer —y guardar— es el de Tiingo.
  // ⚠️ UNA PRUEBA CIRCUNSTANCIAL NO BASTA SI AL OTRO PROVEEDOR NO SE LE PUDO PREGUNTAR.
  // `EA` lo enseñó: Yahoo devuelve un muñón de seis semanas de 2026 —«no solapa»— mientras
  // Tiingo, que sí tiene sus quince años, estaba sin consultar por cuota agotada. Bloquear
  // ahí habría borrado del backtest un nombre con historia perfecta. Sólo la identificación
  // POSITIVA del instrumento («esto es un ETF») bloquea por su cuenta.
  const directa = [jy, jt].find((j) => j?.prueba === "tipo");
  const incompleto = jy.veredicto === "no comprobado" || jt?.veredicto === "no comprobado";
  const decide = bueno ? { veredicto: "ok", motivo: `vía ${bueno}` }
    : directa ? directa
    : incompleto ? { veredicto: "no comprobado", motivo: (jy.veredicto === "no comprobado" ? jy : jt).motivo }
    : jt?.veredicto === "reutilizado" ? jt
    : jy.veredicto === "reutilizado" ? jy
    : (jt ?? jy);
  // Si Tiingo dio una serie buena, se guarda ya: la cuota está gastada de todos modos.
  const guardadas = decide.veredicto === "ok" && jt?.veredicto === "ok" ? guardarEnCache(t, st.serie) : 0;
  if (guardadas) enCache += guardadas;
  const { serie: _sinSerie, ...tiingoResumen } = st ?? {};
  filas.push({
    ticker: t, desde, hasta, veredicto: decide.veredicto, motivo: decide.motivo,
    fuenteBuena: bueno, seguiaPresentando: vivo, ultimoInforme: informe,
    yahoo: { ...sy, juicio: jy.veredicto, motivo: jy.motivo },
    tiingo: st ? { ...tiingoResumen, juicio: jt.veredicto, motivo: jt.motivo } : null,
  });
  process.stdout.write(`\r  ${String(n).padStart(3)}/${auditar.length}  ${t.padEnd(8)} ${decide.veredicto.padEnd(12)} ${decide.motivo.slice(0, 52).padEnd(53)}`);
}
console.log("\n");

const malos = filas.filter((f) => f.veredicto === "reutilizado");
const sinDatos = filas.filter((f) => f.veredicto === "sin datos");
const noComp = filas.filter((f) => f.veredicto === "no comprobado");
const buenos = filas.length - malos.length - sinDatos.length - noComp.length;
console.log(`  ok: ${buenos}   ·   REUTILIZADOS: ${malos.length}   ·   sin datos: ${sinDatos.length}   ·   NO COMPROBADOS: ${noComp.length}\n`);
if (noComp.length) {
  console.log(`  ⚠ ${noComp.length} sin comprobar — el proveedor no contestó (cuota o red), que NO es lo mismo que «no hay datos».`);
  console.log(`     No se bloquea ninguno. Vuelve a correrlo cuando se recupere la cuota para cerrarlos:`);
  console.log(`       ${noComp.map((f) => f.ticker).join(" ")}\n`);
}
for (const f of malos) console.log(`    ${f.ticker.padEnd(8)} ${f.desde}→${f.hasta}   ${f.motivo}`);
if (sinDatos.length) console.log(`\n  sin datos en ninguna fuente: ${sinDatos.map((f) => f.ticker).join(" ")}`);

if (SOLO) { console.log(`\n  (--solo: prueba de depuración, no se escribe nada)\n`); process.exit(0); }

// ⚠️ LA LISTA SÓLO ENCOGE CON EVIDENCIA, NUNCA POR SILENCIO.
//
// Los «no comprobados» cambian de una pasada a otra según haya cuota. Si el fichero se
// reescribiera con lo que se pudo mirar HOY, un ticker bloqueado ayer y no comprobado hoy
// quedaría desbloqueado sin que nadie lo decidiera, y volverían sus precios ajenos. Así que:
// un bloqueo se hereda mientras no haya una respuesta REAL que lo levante — y cuando la hay
// («ok»), se levanta solo.
//
// ⚠️ PERO NO A TRAVÉS DE UN CAMBIO DE REGLAS, y esto costó un bloqueo falso. La herencia de
// bloqueos es deliberadamente distinta de la de veredictos: aquélla mira la versión y ésta no
// miraba nada, así que un símbolo bloqueado por una regla que después resultó EQUIVOCADA se
// arrastraba para siempre — cada pasada lo veía «no comprobado» por cuota y lo heredaba otra
// vez, sin que ninguna respuesta real pudiera levantarlo. Le pasó a `AVP`: bloqueado por la
// regla de la cola cuando nadie había podido comprobar si Avon seguía presentando informes
// (presentó hasta 2023-05-15). Ahora un cambio de versión también corta esta herencia.
//
// Lo que protege al backtest mientras tanto NO es un bloqueo viejo, sino la puerta de §10.7:
// no se rebuildea con ningún ticker publicado en «no comprobado».
const ruta = join(DATA, "simbolos_reutilizados.json");
let previos = {};
try {
  if (existsSync(ruta)) {
    const prev = JSON.parse(readFileSync(ruta, "utf8"));
    if ((prev?.versionReglas ?? 0) === VERSION_REGLAS) previos = prev?.bloqueados ?? {};
    else console.log(`  ⚠ los bloqueos anteriores se hicieron con las reglas v${prev?.versionReglas ?? 0} y ahora van por la v${VERSION_REGLAS}: NO se heredan, hay que volver a ganárselos.`);
  }
} catch { previos = {}; }
const bloqueados = Object.fromEntries(malos.map((f) => [f.ticker, f.motivo]));
const heredados = [];
for (const f of noComp) {
  if (previos[f.ticker] && !bloqueados[f.ticker]) { bloqueados[f.ticker] = previos[f.ticker]; heredados.push(f.ticker); }
}
if (enCache) console.log(`  💾 ${enCache} ficheros de caché de precios escritos de paso — el backtest no tendrá que volver a gastar cuota en ellos`);
if (heredados.length) console.log(`  ↻ ${heredados.length} bloqueos heredados de la pasada anterior por no haberse podido comprobar: ${heredados.join(" ")}`);

// El fichero que consumen los módulos de precios. En `data/`, que se versiona por defecto:
// si esto se perdiera, el bloqueo desaparecería en silencio y volverían los precios ajenos.
writeFileSync(ruta, JSON.stringify({
  generatedAt: new Date().toISOString(),
  fuente: "research/simbolos_reutilizados.mjs",
  versionReglas: VERSION_REGLAS,
  evidencia: "research/out/simbolos_reutilizados.json",
  noComprobados: noComp.map((f) => f.ticker),
  heredados,
  criterio: `la serie debe solapar con el periodo en el índice y no puede seguir más de ${GRACIA_DIAS} días tras salir de él; un ETF o un fondo nunca es un miembro del índice. Las pruebas circunstanciales (solape, cola) sólo bloquean si se pudo consultar a los dos proveedores; la identificación directa del instrumento bloquea sola.`,
  bloqueados,
}, null, 1));
// ⚠️ `versionReglas` AQUÍ TAMBIÉN, y no es un duplicado del de arriba: éste es el fichero que
// se RELEE para heredar (más arriba, en el bloque incremental), así que es el ÚNICO sitio donde
// el sello sirve de algo. Sin él, `prev.versionReglas ?? 0` valía 0, nunca coincidía con la
// versión actual, y la herencia no ocurría jamás: cada pasada volvía a empezar por `AAL` y se
// paraba donde se hubiera parado la anterior. Es decir, exactamente lo que el comentario del
// bloque incremental dice que NO puede pasar — la auditoría no habría terminado nunca.
// Encontrado corriéndola, no leyéndola: el aviso "la evidencia anterior se hizo con las reglas
// v0" salió en una pasada en la que la evidencia anterior la había escrito esta misma versión.
writeFileSync(join(OUT, "simbolos_reutilizados.json"), JSON.stringify({ generatedAt: new Date().toISOString(), versionReglas: VERSION_REGLAS, auditados: filas.length, reutilizados: malos.length, sinDatos: sinDatos.length, noComprobados: noComp.length, detalle: filas }, null, 1));

// Y se tira lo que ya se había guardado de ellos. El bloqueo actúa antes de leer la caché, así
// que estos ficheros son inertes — pero dejar en disco 310 KB de un ETF bajo el nombre `GENZ`
// es dejar una trampa cargada para el próximo que lea la caché a mano.
let borradas = 0;
for (const t of Object.keys(bloqueados)) {
  for (const d of ["px", "px_long"]) {
    for (const suf of ["", ".t"]) {
      const p = join(AQUI, ".cache", d, `${t.replace(/[^A-Za-z0-9_.-]/g, "")}.json${suf}`);
      try { if (existsSync(p)) { rmSync(p); borradas++; } } catch { /* si no se puede borrar, el bloqueo sigue actuando igual */ }
    }
  }
}
if (borradas) console.log(`  🗑  ${borradas} ficheros de caché de precios borrados (eran de otro instrumento)`);
console.log(`\n  → research/data/simbolos_reutilizados.json  ·  research/out/simbolos_reutilizados.json\n`);
