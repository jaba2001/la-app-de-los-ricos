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

/** Con menos campos que esto, dos grupos coinciden por redondeo y no por identidad. */
const MIN_CAMPOS = 3;

/** Por encima de esto, una lista es una tabla de datos y no un juego de variantes. */
const MAX_HERMANOS = 40;

/**
 * Coincidencias ya miradas y explicadas. Sin motivo escrito no entran: una lista de
 * excepciones muda es exactamente el sitio donde se esconden los fallos que esto busca.
 */
const TOLERADOS = new Map([
  ["picks_rules_backtest.json :: barridoUmbrales[7] == ablacionReglas.reglas completas (§2-§6)",
   "Son la MISMA configuración: el punto del barrido que coincide con los ajustes de producción. Idénticos por construcción."],
  ["picks_rules_backtest_oos.json :: barridoUmbrales[7] == ablacionReglas.reglas completas (§2-§6)",
   "Igual que la anterior, en la ventana antigua."],

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
  ["momentum_lab_smoke.json :: ic.mom12_1 == ic.rs_spy",
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
    if (Object.keys(firma).length >= MIN_CAMPOS) acc.push([ruta || "(raíz)", firma]);
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

let ficheros = [];
try { ficheros = readdirSync(OUT).filter((f) => f.endsWith(".json")).sort(); } catch { /* sin out/ */ }

const hallazgos = [];
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
  for (const [ruta, firma] of grupos) {
    const pa = padreDe(ruta);
    if ((cuantos.get(pa) ?? 0) > MAX_HERMANOS) continue;
    const c = pa + " ⇢ " + claveDe(firma);
    if (!cubos.has(c)) cubos.set(c, []);
    cubos.get(c).push([ruta, firma]);
  }
  for (const iguales of cubos.values()) {
    if (iguales.length < 2) continue;
    for (let i = 0; i < iguales.length; i++) {
      for (let k = i + 1; k < iguales.length; k++) {
        const [ra, fa] = iguales[i], [rb] = iguales[k];
        if (TOLERADOS.has(claveTolerancia(f, ra, rb))) continue;
        hallazgos.push({ f, ra, rb, firma: fa });
      }
    }
  }
}

console.log("\n  VARIANTES QUE DAN EXACTAMENTE LO MISMO\n");
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
