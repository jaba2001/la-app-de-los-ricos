// ─────────────────────────────────────────────────────────────────────────────
// LAS CIFRAS PUBLICADAS TIENEN QUE SEGUIR SIENDO CIERTAS
//
// ⚠️ ESTE FICHERO EXISTE POR UNA PREGUNTA QUE NO SUPE CONTESTAR. Al auditar aparecieron unas
// cifras de Microsoft publicadas en un documento sin ningún test que las guardara, y la
// pregunta obvia fue: **¿y las demás?** Medido: los cuatro documentos de análisis publican
// **194 cifras notables**, y aunque muchas son años o citas de los vídeos, las que son
// MEDICIONES NUESTRAS podían derivar sin que nada protestara.
//
// El defecto no es de una cifra concreta: es que **la prosa nunca se comparaba con la
// evidencia**. Un documento puede decir «Oracle 638 B$» mientras el artefacto dice otra cosa, y
// los dos ficheros seguir en verde por separado. Aquí se cruzan.
//
// Cada entrada declara: el documento, la cifra tal y como aparece ESCRITA, y de dónde sale.
// Si alguien reejecuta una medición y el resultado cambia, este test falla y obliga a
// actualizar el texto — que es exactamente lo que debe pasar.
//
// Sólo lee ARTEFACTOS VERSIONADOS y documentos, nunca la caché: tiene que correr en CI.
//
//   node --experimental-strip-types --no-warnings scripts/cifras_publicadas.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };

const doc = (n) => { try { return readFileSync(n, "utf8"); } catch { return null; } };
const art = (n) => { try { return JSON.parse(readFileSync(`research/out/${n}.json`, "utf8")); } catch { return null; } };

/**
 * ¿Está el número escrito en el texto, en formato español (coma decimal) o inglés?
 *
 * ⚠️ ESTA FUNCIÓN NACIÓ ROTA DE DOS MANERAS, y las dos las cazó su control positivo. Merece
 * quedar escrito porque son la misma familia que este fichero existe para vigilar:
 *
 *   1. **`includes` es subcadena.** Cambiar «149» por «1490» en el documento seguía pasando,
 *      porque «1490» contiene «149». Hace falta frontera de número.
 *   2. **Y la peor: se generaba también la forma con CERO decimales.** Para 0,705 eso es «1»,
 *      y para 0,339 es «0» — cadenas que aparecen en cualquier texto. Con eso, TODA
 *      comprobación de un número menor que 1 pasaba trivialmente. Cuatro de los seis controles
 *      positivos no saltaban por esto.
 *
 * Ahora: frontera explícita, y sólo las formas con la precisión pedida y una más.
 */
const citado = (texto, v, dec = 1) => {
  const n = Math.abs(Number(v));
  const formas = new Set();
  for (const d of [dec, dec + 1]) {
    const s = n.toFixed(d);
    formas.add(s); formas.add(s.replace(".", ","));
    // La forma sin decimales sólo vale si el número es grande: para 0,7 sería «1» y casa con todo.
    if (n >= 10) { const e = Math.round(n).toString(); formas.add(e); }
    if (n >= 1000) formas.add(Math.round(n).toLocaleString("es-ES"));
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Frontera de numero: ni digito ni separador decimal pegado a ninguno de los dos lados.
  return [...formas].some((f) => new RegExp(`(?<![\\d.,])${esc(f)}(?![\\d])`).test(texto));
};

/** Como `citado`, para cifras enteras escritas tal cual (149, 224, 638). */
const citadoEntero = (texto, s) => new RegExp(`(?<![\\d.,])${s}(?![\\d])`).test(texto);

// ── Los artefactos de los que salen las cifras ──────────────────────────────────────────
const V = art("verificacion_videos"), CC = art("calidad_contable");
const TR = art("tipos_reales"), PA = art("precheck_aceleracion"), PC = art("precheck_credito");
const AC = art("aviso_credito_base"), CJ = art("calidad_caja"), OR = art("oro_respaldo");

ok(V && CC && TR && PA && PC && AC, "los artefactos que sostienen las cifras existen y son legibles");

// ── PLAN_CUATRO_VIDEOS.md ───────────────────────────────────────────────────────────────
{
  const d = doc("PLAN_CUATRO_VIDEOS.md");
  ok(d != null, "PLAN_CUATRO_VIDEOS.md existe");
  if (d && V) {
    // El backlog de Oracle y el capex salen del texto de `medido`, no de un campo numérico.
    const oracle = V.comprobaciones.find((x) => /Backlog de Oracle/.test(x.que));
    ok(oracle && oracle.coincide === true, "el artefacto confirma el backlog de Oracle");
    ok(citadoEntero(d, "638") && citadoEntero(d, "363"), "y el documento cita 638 B$ y +363 %");
    ok(oracle && /638/.test(oracle.medido) && /363/.test(oracle.medido),
       `el artefacto mide lo mismo que el documento dice (${oracle?.medido})`);

    const capex = V.comprobaciones.find((x) => /Capex de los cinco/.test(x.que));
    ok(capex && capex.coincide === true, "el artefacto confirma la serie de capex");
    for (const n of ["149", "224", "379"])
      ok(capex && citadoEntero(capex.medido, n) && citadoEntero(d, n), `${n} B$ está en el artefacto Y en el documento`);

    const ratio = V.comprobaciones.find((x) => /supera a toda la caja/.test(x.que));
    ok(ratio && /0\.66|0,66/.test(ratio.medido) && citado(d, 0.66, 2),
       "el ratio capex/flujo operativo de 0,66 coincide en los dos");
    ok(ratio && ratio.coincide === false, "y el artefacto lo marca como que DIFIERE del vídeo");
  }
  // La vida útil y las coberturas, contra `calidad_contable`.
  if (d && CC) {
    const r = CC.resumen;
    const covVida = Math.round((100 * r.conVida) / r.leidos);
    const covRec = Math.round((100 * r.conRecompra) / r.leidos);
    ok(citado(d, covVida, 0), `la cobertura de vida útil del artefacto (${covVida} %) está citada en el documento`);
    ok(citado(d, covRec, 0), `y la de recompras (${covRec} %)`);
    const imposible = Math.round((100 * r.recompraImposible) / (r.conRecompra || 1));
    ok(citado(d, imposible, 0), `y el porcentaje de precios imposibles (${imposible} %)`);
  }
  // La sensibilidad al tipo real.
  if (d && TR) {
    const oro = TR.activos.find((x) => x.ticker === "GLD");
    ok(citado(d, oro.rhoContemporaneo, 3) || d.includes("−0,34") || d.includes("-0,34"),
       `el rho contemporáneo del oro (${oro.rhoContemporaneo}) está citado`);
    ok(citado(d, oro.retornoBajando, 2), `y el +${oro.retornoBajando} %/mes con el tipo real bajando`);
    ok(citado(d, oro.retornoSubiendo, 2), `y el ${oro.retornoSubiendo} % subiendo`);
  }
  // El veredicto de la fase C, con su margen.
  if (d && PA) {
    ok(citado(d, PA.puerta1.rho, 3), `la puerta 1 (${PA.puerta1.rho}) está citada`);
    ok(citado(d, PA.puerta2.rho, 3), `y la puerta 2 (${PA.puerta2.rho})`);
    ok(PA.alFilo === true && /cinco milésimas|cinco milesimas|margen/i.test(d),
       "y el documento recoge que el margen es al filo, no un veredicto limpio");
  }
}

// ── ANALISIS_VIDEO_IA_2006.md ───────────────────────────────────────────────────────────
{
  const d = doc("ANALISIS_VIDEO_IA_2006.md");
  ok(d != null, "ANALISIS_VIDEO_IA_2006.md existe");
  if (d && V) {
    const cs = V.comprobaciones.find((x) => /pico ANTES que el nivel/.test(x.que));
    ok(cs && cs.coincide === true, "el artefacto confirma el adelanto del Case-Shiller");
    // Las fechas y el adelanto, tal y como los publica el documento.
    for (const t of ["2005-09", "2006-07"])
      ok(cs.medido.includes(t) && d.includes(t), `${t} está en el artefacto Y en el documento`);   // fechas: la subcadena vale
    ok(/10 meses/.test(cs.medido) && /10 meses/.test(d), "y los 10 meses de adelanto, en los dos");
    ok(/14\.5|14,5/.test(cs.medido) && citado(d, 14.5, 1), "y el 14,5 % de crecimiento en el pico");

    const mor = V.comprobaciones.find((x) => /Morosidad/.test(x.que));
    ok(mor && mor.coincide === false, "el artefacto marca que la morosidad DIFIERE de lo que dice el vídeo");
    ok(/1\.62|1,62/.test(mor.medido) && citado(d, 1.62, 2), "y el 1,62 % coincide");
    ok(/1\.41|1,41/.test(mor.medido) && citado(d, 1.41, 2), "y el mínimo de 1,41 %");
    ok(/otra poblaci/.test(mor.nota ?? "") && /otra poblaci/.test(d),
       "y los dos dicen que se está midiendo otra población que la del vídeo");
  }
}

// ── Las constantes de lib/ contra sus artefactos ────────────────────────────────────────
// ⚠️ Ya se comprobaba a mano en la auditoría; aquí queda fijado para que no dependa de que
// alguien se acuerde de mirarlo.
{
  const t = readFileSync("lib/tipos.ts", "utf8");
  if (AC) {
    ok(t.includes(`p: ${AC.episodioTest.p.toFixed(3)}`), `BASE_AVISO.p = el artefacto (${AC.episodioTest.p})`);
    ok(t.includes(`episodios: ${AC.episodioTest.n}`), `BASE_AVISO.episodios = ${AC.episodioTest.n}`);
    ok(t.includes(`seguidosDeUnBuenAno: ${AC.falsasAlarmas.length}`), `BASE_AVISO falsas alarmas = ${AC.falsasAlarmas.length}`);
    ok(!/p = 0,149|p: 0\.149/.test(t), "y NINGUNA referencia al 0,149 anterior a la semilla fija");
  }
  if (TR) {
    const oro = TR.activos.find((x) => x.ticker === "GLD");
    ok(t.includes(`contemporaneo: ${oro.rhoContemporaneo}`), `SENSIBILIDAD_REAL.oro.contemporaneo = ${oro.rhoContemporaneo}`);
    ok(t.includes(`predictivo: ${oro.rhoPredictivo}`), `SENSIBILIDAD_REAL.oro.predictivo = ${oro.rhoPredictivo}`);
    ok(t.includes(`rhoMedioContemporaneo: ${TR.rhoMedioContemporaneo}`), `rhoMedioContemporaneo = ${TR.rhoMedioContemporaneo}`);
    ok(t.includes(`rhoMedioPredictivo: ${TR.rhoMedioPredictivo}`), `rhoMedioPredictivo = ${TR.rhoMedioPredictivo}`);
  }
}

// ── Los prechecks: el veredicto tiene que seguir siendo el que se publicó ────────────────
{
  ok(PC && PC.spearman >= PC.criterioPreescrito,
     `el precheck de crédito sigue por encima de su criterio (${PC?.spearman} >= ${PC?.criterioPreescrito})`);
  ok(PA && (PA.puerta1.cerrada || PA.puerta2.cerrada),
     "y el de aceleración sigue con al menos una puerta cerrada: el ensayo 345 sigue sin gastarse");
  // ⚠️ Si alguna vez se abre, el documento deja de ser cierto y hay que reescribirlo.
  const d = doc("PLAN_CUATRO_VIDEOS.md");
  ok(d && /NO SE GASTA|no se gasta/i.test(d), "y el documento lo dice así");
}

// ── Que los artefactos no se queden atrás del código que los produce ────────────────────
// Un artefacto viejo cuadra con un documento viejo y los dos mienten a la vez.
{
  for (const [n, a] of [["verificacion_videos", V], ["calidad_contable", CC], ["tipos_reales", TR],
                        ["precheck_aceleracion", PA], ["calidad_caja", CJ], ["oro_respaldo", OR]]) {
    if (!a) { ok(false, `el artefacto ${n} no se puede leer`); continue; }
    ok(typeof a.generatedAt === "string" && a.generatedAt >= "2026-09-01",
       `${n} lleva fecha de generación reciente (${a.generatedAt?.slice(0, 10)})`);
    ok(existsSync(`research/${n === "calidad_caja" ? "calidad_caja" : n}.mjs`) ||
       existsSync(`research/${n}.mjs`), `y existe el script que lo produce`);
  }
}

console.log(pass && !fail ? `\n✓ cifras publicadas: ${pass} passed, 0 failed\n` : `\n✖ cifras publicadas: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
