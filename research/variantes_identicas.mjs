// ─────────────────────────────────────────────────────────────────────────────
// DOS VARIANTES QUE DAN EXACTAMENTE LO MISMO
//
// ⚠️ EXISTE POR EL FALLO DE §11, encontrado el 2026-09-01.
//
// El artefacto del backtest publicaba dos referencias equiponderadas —con financieros y sin
// ellos— y las dos daban los MISMOS cuatro números al decimal: +174 % / +174 %, Sharpe 0,77 en
// ambas, mismo drawdown. Con 56 nombres supuestamente excluidos. Esa coincidencia no era una
// curiosidad: era la única señal visible de que `universoEW(eje, excluir)` ignoraba `excluir` y
// devolvía la misma curva dos veces. Estuvo publicada meses, y encima sirvió de prueba para
// afirmar que la ventaja de Scora no era un sesgo sectorial disfrazado.
//
// LA REGLA: dos variantes de un cálculo que coinciden en TODOS sus campos de resultado no son
// una tranquilidad, son una hipótesis a descartar. O una de las dos no se está calculando, o
// la variante no cambia nada y sobra.
//
//   node --experimental-strip-types --no-warnings research/variantes_identicas.mjs
//
// CÓMO DISTINGUE PARÁMETROS DE RESULTADOS, que es lo que lo hace utilizable: `entry` y `exit`
// son la CONFIGURACIÓN de una variante y siempre difieren, así que compararlos garantizaría no
// encontrar nunca nada. Se excluyen (ver PARAMETROS) y se comparan sólo los resultados.
//
// Y SÓLO COMPARA HERMANOS —dos ramas del mismo padre—, que es donde viven las variantes de un
// mismo cálculo: `benchmarks.universoEW` contra `benchmarks.universoEWSinFinancieros`, o dos
// puntos del mismo barrido. Sin esa restricción salían las tablas de cobertura, donde `con=1
// de=3 pct=33` colisiona solo por tener denominadores pequeños, y eso no es una variante de
// nada. Las tablas de datos largas (más de MAX_HERMANOS filas) también se saltan: son registros,
// no configuraciones que comparar.
//
// REGISTROS FRENTE A VARIANTES, que es la distinción que lo hace usable en artefactos de datos.
// Si dos hermanos llevan un campo de IDENTIDAD distinto —`ticker`, `cik`, `symbol`— no son dos
// variantes de un cálculo: son dos ENTIDADES, y que sus números coincidan es una coincidencia del
// mundo, no una pista. Medido el 2026-09-02: PCG y EIX, las dos eléctricas de California, cayeron
// −24,6022 % y −24,5984 % en la misma semana. Números distintos que redondean al mismo −24,6. Un
// guardián que se pone rojo cada vez que dos valores co-mueven acaba desactivado, y eso es peor
// que no tenerlo.
//
// Y LA VUELTA, que antes no veía en absoluto: si dos hermanos llevan la MISMA identidad, eso sí
// es un fallo —la misma entidad publicada dos veces— y se señala aparte, sin pasar por TOLERADOS.
// Distinguir las dos direcciones cuesta lo mismo que ignorar las dos.
//
// Es un detector de humo: una coincidencia NO prueba que haya un fallo. Dos ramas pueden dar lo
// mismo legítimamente —una referencia que no depende del parámetro que se barre, un umbral que
// no llega a morder—. Lo que exige es una explicación escrita, en TOLERADOS.
//
// Sale con código 1 si encuentra una coincidencia no tolerada.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");

/** Configuración de la variante, no resultado. Comparar esto haría inútil el barrido. */
const PARAMETROS = new Set(["entry", "exit", "top", "topN", "k", "K", "n", "meses", "dias", "deCuantos", "financierosExcluidos", "excluidos"]);

/**
 * Campos que dicen DE QUÉ es la fila. Si dos hermanos los llevan y difieren, son entidades
 * distintas y no variantes de un cálculo — ver la nota de la cabecera.
 */
const IDENTIDAD = ["ticker", "symbol", "cik", "id", "emisor", "issuer"];

/** La identidad de una fila, o `undefined` si no lleva ninguna. */
const identidadDe = (o) => {
  for (const k of IDENTIDAD) {
    const v = o?.[k];
    if (typeof v === "string" && v.trim()) return `${k}=${v.trim()}`;
    if (typeof v === "number" && Number.isFinite(v)) return `${k}=${v}`;
  }
  return undefined;
};

/** Con menos campos que esto, dos grupos coinciden por redondeo y no por identidad. */
const MIN_CAMPOS = 3;

/** Por encima de esto, una lista es una tabla de datos y no un juego de variantes. */
const MAX_HERMANOS = 40;

/**
 * Coincidencias ya miradas y explicadas. Sin motivo escrito no entran: una lista de
 * excepciones muda es exactamente el sitio donde se esconden los fallos que esto busca.
 */
// ⚠️ TRES TOLERANCIAS RETIRADAS el 2026-09-02, encontradas por el aviso de tolerancias muertas
// que se añadió ese mismo día. Ninguna podía saltar ya, y llevaban meses aparentando vigilar:
//
//   · `barridoUmbrales[7] == ablacionReglas.reglas completas` (x2, reciente y antigua). Los
//     números SIGUEN siendo idénticos —209,7 / 126 / 0,72 / −26,4—, pero desde que se añadió la
//     regla de «sólo hermanos» tienen padres distintos (`barridoUmbrales` y `ablacionReglas`) y
//     ni se comparan. La excepción sobrevivió al refactor que la dejó sin objeto.
//   · `momentum_lab_smoke.json`: los ficheros `_smoke` se excluyen desde que existe `ES_HUMO`.
const TOLERADOS = new Map([

  // ── rs_spy y mom12_1: idénticos por ÁLGEBRA, no por fallo ────────────────────────────────
  // `rs_spy = mom12_1 − spyMom`, y `spyMom` (el momento del propio SPY) es constante DENTRO de
  // cada fecha. El IC es un Spearman TRANSVERSAL, y restar una constante a todos los valores de
  // una fecha no altera el orden: la correlación sale idéntica por construcción.
  //
  // Que no sea un fallo no lo hace irrelevante. Significa que **rs_spy no aporta absolutamente
  // nada a un ranking transversal** por encima de mom12_1 — y aun así pesa 0,10 en el compuesto
  // de momentum (WEIGHTS en momentum_audit.mjs). La tabla de IC por componente lo presentaba
  // como dos señales con dos filas, cuando es una sola contada dos veces. No cambia la
  // conclusión (el momentum está descartado), pero sí lo que ese 0,10 estaba comprando.
  ["momentum_audit.json :: A1_significance.mom12_1 == A1_significance.rs_spy",
   "rs_spy = mom12_1 − constante de la fecha; el IC transversal es el mismo por álgebra."],
  ["momentum_audit_long.json :: A1_significance.mom12_1 == A1_significance.rs_spy",
   "Igual: identidad algebraica, no coincidencia."],
  ["momentum_lab.json :: ic.mom12_1 == ic.rs_spy",
   "Igual: identidad algebraica, no coincidencia."],

  // ── Coincidencias de denominador pequeño o marcador perfecto ──────────────────────────────
  ["desfase_periodos.json :: parejas.ocf|cfi == parejas.ni|ocf",
   "Las dos parejas puntúan PERFECTO (497 de 497, cero desalineados). Cuando dos medidas tocan su tope no hay nada que las distinga; eso es el resultado, no un empate sospechoso."],
  ["banca_cobertura.json :: metricas.Capital CET1 (%).Banca / otros == metricas.Capital CET1 (%).Inmobiliario",
   "Dos subsectores de TRES empresas cada uno, los dos a cero. Con denominadores así, coincidir es lo normal."],
  ["banca_cobertura.json :: metricas.Primas devengadas.Banca / otros == metricas.Primas devengadas.Inmobiliario",
   "Igual: 0 de 3 en ambos."],
  ["banca_cobertura.json :: metricas.Siniestralidad.Banca / otros == metricas.Siniestralidad.Inmobiliario",
   "Igual: 0 de 3 en ambos."],
  ["banca_cobertura.json :: metricas.Gastos de adquisición.Banca / otros == metricas.Gastos de adquisición.Inmobiliario",
   "Igual: 0 de 3 en ambos."],
  ["banca_cobertura.json :: modelos.Seguros · siniestralidad.Banca / otros == modelos.Seguros · siniestralidad.Inmobiliario",
   "Igual: 0 de 3 en ambos."],

  // ── El umbral de salida que nunca llega a morder ──────────────────────────────────────────
  // Con la entrada en el percentil 90 apenas entra nadie: 30 posiciones y 16 % invertido en la
  // ventana reciente, 19 y 11 % en la antigua. Con tan pocos nombres, ninguno llegó a caer en
  // la banda p40-p50 (ni p40-p60 en la ventana antigua), así que mover la salida no cambia una
  // sola operación y los siete campos salen iguales.
  //
  // Se distingue del no-op de §11 en que aquí el parámetro SÍ se usa: con salida en p60 y
  // entrada en p85 el resultado sí cambia. Es el dato el que no da para que muerda, no el
  // código el que lo ignora.
  ["picks_rules_backtest.json :: barridoUmbrales[12] == barridoUmbrales[13]",
   "entrada p90: 30 posiciones, ninguna cae en la banda p40-p50, así que la salida no llega a actuar."],
  ["picks_rules_backtest_oos.json :: barridoUmbrales[12] == barridoUmbrales[13]",
   "Igual en la ventana antigua, con 19 posiciones."],
  ["picks_rules_backtest_oos.json :: barridoUmbrales[12] == barridoUmbrales[14]",
   "Igual: con entrada en p90 la salida no muerde ni en p60."],
  ["picks_rules_backtest_oos.json :: barridoUmbrales[13] == barridoUmbrales[14]",
   "Igual que las dos anteriores."],

  // ── Un no-op de verdad, y el detector haciendo su trabajo ─────────────────────────────────
  // En la ventana 2011-2018 la cartera NUNCA tuvo dos clases de la misma empresa (medido con
  // `doble_clase.mjs`: cero solapes), así que deduplicar no cambia una sola operación y las dos
  // ramas salen idénticas — por construcción, no por un parámetro ignorado.
  //
  // Es justo el contraste que hacía falta: el mismo síntoma que delató el no-op de §11 aparece
  // aquí con una causa legítima. Por eso el detector exige explicación en vez de fallar solo: la
  // coincidencia es la pregunta, no la respuesta.
  ["picks_rules_backtest_oos.json :: ablacionReglas.reglas completas (§2-§6) == ablacionReglas.sin deduplicar (como la v2)",
   "En 2011-2018 la cartera nunca tuvo dos clases de la misma empresa (cero solapes, medido con doble_clase.mjs), así que la regla de §2quater es un no-op REAL en esa ventana. La reciente sí difiere: 209,7 contra 216,6."],

  // ── Dos proveedores que dicen lo mismo ────────────────────────────────────────────────────
  // Yahoo y Tiingo devolviendo el mismo número de barras para el mismo valor es ACUERDO entre
  // fuentes independientes, que es justo lo que se quiere de una auditoría de símbolos. Va por
  // patrón (`[*]`) porque los índices cambian en cada ejecución.
  ["simbolos_reutilizados.json :: detalle[*].yahoo == detalle[*].tiingo",
   "Dos proveedores independientes con la misma historia para el mismo valor: acuerdo, no un no-op."],
]);

/** Todos los campos numéricos de RESULTADO de un objeto (sin la configuración). */
function firmaDe(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number" && Number.isFinite(v) && !PARAMETROS.has(k)) f[k] = v;
  }
  return f;
}

/** Recorre el JSON y devuelve [ruta, firma] de cada grupo con suficientes campos de resultado. */
function gruposDe(obj, ruta = "", acc = []) {
  if (obj == null || typeof obj !== "object") return acc;
  if (!Array.isArray(obj)) {
    const firma = firmaDe(obj);
    if (Object.keys(firma).length >= MIN_CAMPOS) acc.push([ruta || "(raíz)", firma, identidadDe(obj)]);
    for (const [k, v] of Object.entries(obj)) gruposDe(v, ruta ? `${ruta}.${k}` : k, acc);
  } else {
    obj.forEach((v, i) => gruposDe(v, `${ruta}[${i}]`, acc));
  }
  return acc;
}

/**
 * Clave de agrupación: la firma entera, con los campos ordenados. Dos grupos con la misma
 * clave son idénticos en todos sus campos de resultado.
 *
 * Se indexa en vez de comparar todos contra todos: un artefacto de barrido trae miles de
 * grupos y el cuadrado no termina. Con el índice, el coste es lineal.
 */
const claveDe = (firma) =>
  Object.keys(firma).sort().map((k) => k + "=" + firma[k]).join("|");

/**
 * Clave con la que se busca en TOLERADOS.
 *
 * Si las dos rutas llevan EL MISMO índice de fila —`detalle[180].yahoo` contra
 * `detalle[180].tiingo`— lo que se está comparando son dos campos de una misma fila, y eso vale
 * igual para todas las filas: el índice se normaliza a `[*]` y una sola tolerancia las cubre.
 *
 * Si los índices DIFIEREN —`barridoUmbrales[12]` contra `[13]`— son dos configuraciones
 * distintas y la clave se queda exacta. Tolerar una pareja del barrido no puede tolerar las
 * demás: cada una necesita su propia explicación.
 */
function claveTolerancia(fichero, ra, rb) {
  const ia = ra.match(/\[\d+\]/g), ib = rb.match(/\[\d+\]/g);
  const mismos = ia && ib && ia.length === ib.length && ia.every((x, i) => x === ib[i]);
  const norm = (r) => (mismos ? r.replace(/\[\d+\]/g, "[*]") : r);
  return `${fichero} :: ${norm(ra)} == ${norm(rb)}`;
}

/** El padre de `a.b.c` es `a.b`; el de `x[3]` es `x`. Los hermanos comparten padre. */
function padreDe(ruta) {
  const corchete = ruta.lastIndexOf("[");
  if (corchete >= 0 && ruta.endsWith("]")) return ruta.slice(0, corchete);
  const punto = ruta.lastIndexOf(".");
  return punto >= 0 ? ruta.slice(0, punto) : "(raíz)";
}

// Los artefactos de humo NO cuentan. `--smoke` corre 14 fechas de decision y deja 12
// posiciones: con tan poco, casi todos los puntos del barrido de umbrales producen el MISMO
// libro, y coincidir es lo normal, no una pista. Medido: 74 coincidencias, todas de ahi.
// Ademas no son cifras publicadas — son una comprobacion mecanica de que el motor arranca.
const ES_HUMO = (f) => f.includes("_smoke");

let ficheros = [];
try { ficheros = readdirSync(OUT).filter((f) => f.endsWith(".json") && !ES_HUMO(f)).sort(); } catch { /* sin out/ */ }

const hallazgos = [], duplicados = [], usadas = new Set();
for (const f of ficheros) {
  let j;
  try { j = JSON.parse(readFileSync(join(OUT, f), "utf8")); } catch { continue; }
  const grupos = gruposDe(j);

  // Cuántos hermanos tiene cada padre, para saltarse las tablas de datos.
  const cuantos = new Map();
  for (const [ruta] of grupos) {
    const pa = padreDe(ruta);
    cuantos.set(pa, (cuantos.get(pa) ?? 0) + 1);
  }

  // Se agrupa por PADRE + firma: sólo se comparan variantes del mismo cálculo.
  const cubos = new Map();
  for (const [ruta, firma, ident] of grupos) {
    const pa = padreDe(ruta);
    if ((cuantos.get(pa) ?? 0) > MAX_HERMANOS) continue;
    const c = pa + " ⇢ " + claveDe(firma);
    if (!cubos.has(c)) cubos.set(c, []);
    cubos.get(c).push([ruta, firma, ident]);
  }
  for (const iguales of cubos.values()) {
    if (iguales.length < 2) continue;
    for (let i = 0; i < iguales.length; i++) {
      for (let k = i + 1; k < iguales.length; k++) {
        const [ra, fa, ida] = iguales[i], [rb, , idb] = iguales[k];

        // Dos ENTIDADES distintas con los mismos números: coincidencia del mundo, no un no-op.
        if (ida && idb && ida !== idb) continue;

        // La misma entidad dos veces: eso sí es un fallo, y no admite tolerancia.
        if (ida && idb && ida === idb) { duplicados.push({ f, ra, rb, ident: ida }); continue; }

        const ct = claveTolerancia(f, ra, rb);
        if (TOLERADOS.has(ct)) { usadas.add(ct); continue; }
        hallazgos.push({ f, ra, rb, firma: fa });
      }
    }
  }
}

console.log("\n  VARIANTES QUE DAN EXACTAMENTE LO MISMO\n");

// La misma entidad dos veces en la misma lista. No pasa por TOLERADOS: no hay explicación
// legítima para publicar dos veces la misma fila.
if (duplicados.length) {
  for (const d of duplicados) {
    console.error(`  ✖ ${d.f} — MISMA ENTIDAD DOS VECES (${d.ident})`);
    console.error(`      ${d.ra}`);
    console.error(`      ${d.rb}\n`);
  }
  console.error(`  ⛔ ${duplicados.length} fila(s) duplicada(s). No es una variante: es la misma`);
  console.error(`     entidad publicada dos veces.\n`);
  process.exit(1);
}
// ⚠️ UNA TOLERANCIA QUE YA NO CASA CON NADA es una regla que dejó de vigilar sin decirlo — la
// misma familia de defecto que este guardián persigue: algo que no rompe y contesta que todo va
// bien. O el artefacto cambió de forma y la clave quedó obsoleta, o la coincidencia desapareció
// y sobra la excepción. Avisa sin romper: no es un fallo de datos, es deuda de mantenimiento.
const muertas = [...TOLERADOS.keys()].filter((k) => !usadas.has(k));
if (muertas.length) {
  console.log("  ⚠ " + muertas.length + " tolerancia(s) que ya no casan con nada:");
  for (const m of muertas) console.log("      " + m);
  console.log("      (o el artefacto cambió de forma, o la excepción sobra)");
  console.log("");
}

if (!hallazgos.length) {
  console.log(`  ✅ ninguna sin explicar (${TOLERADOS.size} coincidencias legítimas toleradas con su motivo).\n`);
  process.exit(0);
}
for (const h of hallazgos) {
  const campos = Object.entries(h.firma).map(([k, v]) => `${k}=${v}`).join("  ");
  console.log(`  ✖ ${h.f}`);
  console.log(`      ${h.ra}`);
  console.log(`      ${h.rb}`);
  console.log(`      coinciden en todo: ${campos}`);
}
console.error(`\n  ⛔ ${hallazgos.length} coincidencia(s) exacta(s) entre variantes.`);
console.error(`     No prueba que haya un fallo, pero cada una necesita explicación. Si es`);
console.error(`     legítima, va a TOLERADOS con su motivo. Así estuvo meses el no-op de §11.\n`);
process.exit(1);
