// ─────────────────────────────────────────────────────────────────────────────
// GUARDIÁN DE LA CAPA DE DATOS
//
// Los cinco defectos que se encontraron el 2026-08-23/24 vivieron MESES sin que nada fallara.
// Ninguno rompía: todos devolvían un número creíble. Este fichero existe para que no vuelvan,
// y está pensado para correr en CI, donde NO hay caché de EDGAR (2,2 GB, fuera de git).
//
// Dos partes, porque protegen de cosas distintas:
//
//   A · SOBRE LOS ARTEFACTOS VERSIONADOS, sin red. Caza el commit que degrada la extracción:
//       si la cobertura de una métrica se desploma o aparecen valores imposibles, salta aquí
//       antes de que nadie publique nada encima.
//
//   B · HUMO CONTRA LA SEC DE VERDAD, seis nombres. Caza lo que un artefacto congelado no
//       puede ver: que la SEC cambie un formato, o que un arreglo funcione en la caché vieja
//       y no contra los datos de hoy. Cada nombre está elegido porque reproduce UNO de los
//       cinco defectos; si la SEC no responde, se avisa y se salta en vez de romper el build.
//
//   node --experimental-strip-types --no-warnings scripts/datos.test.mjs [--sin-red]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(RAIZ, "research", "out");
const SIN_RED = process.argv.includes("--sin-red");

let pass = 0, fail = 0, avisos = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✖ ${msg}`); } };
const aviso = (msg) => { avisos++; console.warn(`  ⚠ ${msg}`); };
const leer = (f) => { const p = join(OUT, f); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };

// ══ A · LOS ARTEFACTOS VERSIONADOS ════════════════════════════════════════════════════════
console.log("\n  A · artefactos versionados (sin red)\n");

{
  const j = leer("sanidad_metricas.json");
  if (!j) aviso("falta sanidad_metricas.json — regenéralo con research/sanidad_metricas.mjs");
  else {
    // El umbral NO es cero a propósito. Las anomalías que quedan son reales: GoDaddy, Gartner
    // y Mettler-Toledo tienen patrimonio casi nulo por recompras, así que un ROE de cuatro
    // cifras es aritmética correcta. Un guardián que exigiera cero obligaría a maquillarlas.
    ok(j.totalAnomalias <= 8, `valores imposibles: ${j.totalAnomalias} (tolerancia 8) — mira research/out/sanidad_metricas.json`);
    ok(j.filas >= 400, `el barrido cubre ${j.filas} nombres (mínimo 400)`);

    // Suelos de cobertura. Cada uno se rompió de verdad en algún momento de la auditoría:
    // `netDebtEbitda` cuando la deuda ausente se escribía como cero, `grossProfitability`
    // cuando el margen bruto venía de 2009, `roic` cuando el capital invertido sólo contaba
    // el patrimonio. Una caída por debajo de esto significa que algo dejó de extraerse.
    const SUELO = { roa: 0.95, netMargin: 0.95, revenueGrowth: 0.95, pe: 0.80,
                    grossProfitability: 0.50, roic: 0.65, netDebtEbitda: 0.55, operatingMargin: 0.65 };
    for (const [k, min] of Object.entries(SUELO)) {
      const n = j.cobertura?.[k];
      if (n == null) { aviso(`el artefacto no trae cobertura de ${k}`); continue; }
      ok(n / j.filas >= min, `cobertura de ${k}: ${(100 * n / j.filas).toFixed(0)} % (suelo ${(100 * min).toFixed(0)} %)`);
    }
  }
}

{
  const j = leer("articulacion_lab.json");
  if (!j) aviso("falta articulacion_lab.json");
  else {
    // La partida doble no admite ruido: si el balance baja del 90 %, o los datos empeoraron o
    // la comprobación se planteó mal — que ya pasó cuatro veces.
    const SUELO = { balance: 90, caja: 90, patrimonio: 85, margen: 90 };
    for (const [k, min] of Object.entries(SUELO)) {
      const v = j.identidades?.[k];
      if (!v) { aviso(`el artefacto no trae la identidad ${k}`); continue; }
      ok(v.pctPasan >= min, `identidad "${k}": ${v.pctPasan} % cuadra (suelo ${min} %)`);
    }
    ok((j.confianza?.baja ?? 999) <= 40, `nombres con confianza baja: ${j.confianza?.baja} (tolerancia 40)`);
  }
}

{
  const j = leer("desfase_periodos.json");
  if (!j) aviso("falta desfase_periodos.json");
  else {
    // El defecto original: magnitudes de ejercicios distintos comparadas entre sí. Amazon
    // usaba un margen bruto de 2009 contra un activo de 2026. NINGÚN par puede volver a tener
    // casos por encima de tres años.
    for (const [par, v] of Object.entries(j.parejas ?? {})) {
      const lejanos = v.reparto?.[">3 años"] ?? 0;
      ok(lejanos === 0, `"${par}": ${lejanos} nombres con más de 3 años de desfase (el defecto de Amazon)`);
    }
    // Y el que alimenta los devengos de Sloan tiene que estar perfecto: resultado y flujo del
    // mismo cierre o la resta no es un devengo.
    const nio = j.parejas?.["ni|ocf"];
    if (nio) ok(nio.pctMismoCierre >= 95, `resultado ↔ flujo de explotación: ${nio.pctMismoCierre} % al mismo cierre (suelo 95 %)`);
  }
}

// ── El sesgo de supervivencia, sus dos mitades ───────────────────────────────────────────
//
// Las dos son silenciosas: si estos ficheros desaparecen, nada falla — sencillamente vuelven
// los números viejos, que eran los sesgados. Por eso se comprueban aquí y no en ningún sitio
// donde un fallo se pueda confundir con un aviso.
{
  const dat = (f) => { const p = join(RAIZ, "research", "data", f); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };

  const hist = dat("cik_historicos.json");
  if (!hist) fail++, console.error("  ✖ falta research/data/cik_historicos.json — sin él, las empresas que salieron del índice vuelven a ser invisibles y el backtest recupera el sesgo sin avisar. Regenéralo con research/resolver_cik.mjs");
  else {
    // El suelo detecta que el fichero se ha vaciado o truncado, NO fija un objetivo de
    // cobertura: subirlo hasta rozar la cifra real haría que el guardián fallara cada vez que
    // una revisión legítima retira un CIK dudoso, que es justo lo que debe poder pasar.
    const n = Object.keys(hist.mapa ?? {}).length;
    ok(n >= 80, `cik_historicos: ${n} tickers muertos resueltos (suelo 80; el hueco medido eran 175)`);
    const malos = Object.entries(hist.mapa ?? {}).filter(([, c]) => !/^\d{10}$/.test(c));
    ok(!malos.length, `cik_historicos: todos los CIK con 10 dígitos${malos.length ? ` — mal: ${malos.slice(0, 4).map(([t]) => t).join(", ")}` : ""}`);
    // ⚠️ QUE DOS TICKERS COMPARTAN CIK NO ES UN ERROR AQUÍ, y la primera versión de esta
    // comprobación lo daba por tal. Este mapa da FUNDAMENTALES, y una empresa que cambia de
    // nombre —`CBS`→`VIAC`, `COG`→`CTRA`, `SYMC`→`NLOK`— o que tiene dos clases de acción
    // —`DISCA` y `DISCK`— presenta unos únicos estados financieros. Lo que sí sería un error es
    // compartir PRECIOS, y eso lo impide la regla de alias, que exige correspondencia uno a uno.
    // Aquí sólo se vigila que ningún CIK acapare muchos tickers, que es la firma de un fallo
    // sistemático de asignación.
    const porCik = {};
    for (const [t, c] of Object.entries(hist.mapa ?? {})) (porCik[c] = porCik[c] ?? []).push(t);
    const acaparadores = Object.entries(porCik).filter(([, ts]) => ts.length > 3);
    ok(!acaparadores.length, `cik_historicos: ningún CIK acapara más de 3 tickers${acaparadores.length ? ` — ${acaparadores.map(([c, ts]) => `${c}: ${ts.join(",")}`).join(" · ")}` : ""}`);
    const compartidos = Object.entries(porCik).filter(([, ts]) => ts.length > 1);
    if (compartidos.length) aviso(`cik_historicos: ${compartidos.length} CIK con más de un ticker (renombres o clases): ${compartidos.map(([, ts]) => ts.join("=")).join(" ")}`);

    // TODO PUBLICADO TIENE QUE TENER PERIODO CONOCIDO EN LA EVIDENCIA, y no es burocracia.
    // La regla que impide que dos CLASES de la misma empresa entren como dos posiciones con
    // serie idéntica —el doble conteo disfrazado de `DISCA`/`DISCK`— necesita saber CUÁNDO
    // estuvo cada ticker en el índice, y ese dato sale de `resolucion_cik.json.detalle`. Un
    // ticker publicado que no esté ahí (lo estaría si una revisión a mano rescatara uno de los
    // `noResueltos`) deja esa comprobación sin datos. `publicar_resolucion.mjs` falla en
    // cerrado y le niega el alias, así que el daño está contenido; este test dice POR QUÉ un
    // alias esperado no apareció, que si no es de las cosas que se buscan durante horas.
    const ev = leer("resolucion_cik.json");
    if (!ev) aviso("falta research/out/resolucion_cik.json — sin él no se puede comprobar que todo publicado tenga periodo");
    else {
      const conPeriodo = new Set([...(ev.detalle ?? []), ...(ev.noResueltos ?? [])].map((f) => f.ticker));
      const sinPeriodo = Object.keys(hist.mapa ?? {}).filter((t) => !conPeriodo.has(t));
      ok(!sinPeriodo.length, `cik_historicos: todo ticker publicado tiene periodo conocido en la evidencia${sinPeriodo.length ? ` — sin periodo (no se les dará alias): ${sinPeriodo.slice(0, 6).join(", ")}` : ""}`);
    }
  }

  // ⚠️ UNA PROPUESTA DE LA MÁQUINA NO PUEDE FIGURAR COMO REVISIÓN HUMANA.
  //
  // `cik_revisados.json` se describe como el fichero de las decisiones humanas, pero
  // `revisar_cik.mjs --proponer` escribe en él también. El 2026-08-25 eran 13 de 36, y
  // `publicar_resolucion` las etiquetaba a todas `+revisado`: la salvaguarda que el código
  // prometía cubría 23 de los 121 CIK publicados y no los 121, sin que nada lo dijera.
  //
  // Ahora se distingue `+revisado` de `+corroborado`, y esto lo comprueba. Importa que siga
  // comprobándose porque hay tandas de --proponer programándose sin supervisión: sin este
  // test, la próxima añadiría propuestas automáticas bajo la etiqueta de revisión humana.
  const rev = dat("cik_revisados.json");
  if (!rev?.decisiones) aviso("falta research/data/cik_revisados.json — no se puede comprobar la procedencia de las decisiones");
  else if (hist) {
    const esHumano = (d) => !/--proponer/.test(String(d?.propuestoPor ?? ""));
    const publicados = new Set(Object.keys(hist.mapa ?? {}));
    const auto = Object.entries(rev.decisiones).filter(([t, d]) => publicados.has(t) && !esHumano(d)).map(([t]) => t);
    const ev = hist.porEvidencia ?? {};
    const nCorroborado = Object.entries(ev).filter(([k]) => k === "corroborado" || k.endsWith("+corroborado")).reduce((a, [, v]) => a + v, 0);
    ok(nCorroborado === auto.length, `cik_historicos: las ${auto.length} decisiones escritas por --proponer figuran como «+corroborado», no como revisión humana (porEvidencia cuenta ${nCorroborado})`);
    // Y ninguna decisión puede quedarse sin procedencia declarada: sin ese campo no se sabe
    // quién decidió, y lo que no se sabe acaba contándose como lo más favorable.
    const sinProc = Object.entries(rev.decisiones).filter(([, d]) => !d?.propuestoPor).map(([t]) => t);
    ok(!sinProc.length, `cik_revisados: toda decisión declara quién la tomó${sinProc.length ? ` — sin procedencia: ${sinProc.slice(0, 5).join(", ")}` : ""}`);
  }

  // ── SUELOS DE COBERTURA (fase 0 del roadmap) ────────────────────────────────
  //
  // SON SUELOS, NO OBJETIVOS, y la diferencia importa: van holgadamente por debajo de lo
  // medido para detectar que la extracción se ha ROTO — un tag que cambia de nombre, un
  // endpoint que empieza a devolver otra cosa — sin fallar cada vez que una empresa deja de
  // publicar una magnitud, que es un hecho del mundo y no un defecto del código.
  //
  // El artefacto lo escribe `research/cobertura_metricas.mjs`. Si no está, se avisa y no se
  // falla: es una medición que cuesta 500 consultas y no tiene sentido exigirla en cada test.
  const cob = leer("cobertura_metricas.json");
  if (!cob) aviso("falta research/out/cobertura_metricas.json — regenéralo con research/cobertura_metricas.mjs");
  else {
    ok(cob.conSenal >= 320, `cobertura: ${cob.conSenal} nombres con señal a ${cob.asOf} (suelo 320; medido 358 el 2026-08-25)`);
    ok((cob.campos?.oiTTM?.pct ?? 0) >= 70, `cobertura: oiTTM al ${cob.campos?.oiTTM?.pct} % (suelo 70; medido 77,6)`);
    ok((cob.campos?.revTTM?.pct ?? 0) >= 95, `cobertura: revTTM al ${cob.campos?.revTTM?.pct} % (suelo 95; medido 99,6)`);
    ok((cob.campos?.assets?.pct ?? 0) >= 95, `cobertura: assets al ${cob.campos?.assets?.pct} % (suelo 95; medido 100)`);
    // Y el mapa de dependencias del informe tiene que cubrir las cinco métricas: si alguien
    // añade una a la señal y no la declara ahí, el informe seguiría explicando por qué faltan
    // notas — con una explicación plausible que ya no incluye la nueva.
    const declaradas = Object.keys(cob.dependeDe ?? {}).sort().join(",");
    const enSenal = Object.keys(cob.metricas ?? {}).sort().join(",");
    ok(declaradas === enSenal, `cobertura: el mapa de dependencias cubre exactamente las métricas de la señal (${declaradas} vs ${enSenal})`);
  }

  const bloq = dat("simbolos_reutilizados.json");
  if (!bloq) aviso("falta research/data/simbolos_reutilizados.json — regenéralo con research/simbolos_reutilizados.mjs");
  else {
    ok(Object.keys(bloq.bloqueados ?? {}).length > 0, "simbolos_reutilizados: la lista de bloqueo no está vacía (hay símbolos reutilizados de verdad)");

    // ⚠️ EL SELLO DE VERSIÓN TIENE QUE ESTAR EN LOS DOS FICHEROS, Y VALER LO MISMO.
    //
    // La auditoría es incremental porque no puede no serlo: Tiingo da ~50 peticiones por hora y
    // hay ~290 nombres que mirar, así que cada pasada hereda del fichero de EVIDENCIA lo que ya
    // tenía veredicto firme. Para no heredar a través de un cambio de reglas compara la versión
    // guardada con la actual — pero leía el sello de `out/` y `out/` se escribía SIN sello.
    // `prev.versionReglas ?? 0` valía siempre 0, nunca coincidía, y no se heredaba nunca nada:
    // cada pasada reempezaba por `AAL` y moría de cuota en el mismo sitio. La auditoría no
    // habría terminado jamás. El fallo se ve corriéndola, no leyéndola — por eso hay test.
    const ev = leer("simbolos_reutilizados.json");
    if (!ev) aviso("falta research/out/simbolos_reutilizados.json — es la evidencia de la que hereda la auditoría incremental");
    else ok(ev.versionReglas != null && ev.versionReglas === bloq.versionReglas,
      `simbolos_reutilizados: la evidencia lleva el mismo sello de reglas que el mapa (out=${ev.versionReglas ?? "SIN SELLO"}, data=${bloq.versionReglas}) — si no, la auditoría no hereda nada y no termina nunca`);
  }

  // Un alias de ticker manda los precios de un símbolo a otro. Si el CIK de los dos no
  // coincide, no es un cambio de nombre: es un símbolo reasignado a OTRA empresa, y el alias
  // estaría empalmando los precios de un tercero sin que nada falle. Es la regla que
  // `prices.mjs` exige a mano desde el 2026-08-22; aquí se comprueba para los generados.
  const ali = dat("alias_ticker.json");
  if (!ali) aviso("falta research/data/alias_ticker.json — regenéralo con research/publicar_resolucion.mjs");
  else if (hist) {
    const malos = (ali.detalle ?? []).filter((d) => hist.mapa?.[d.de] !== d.cik);
    ok(!malos.length, `alias_ticker: todo alias empareja dos símbolos del MISMO CIK${malos.length ? ` — mal: ${malos.slice(0, 4).map((d) => `${d.de}→${d.a}`).join(", ")}` : ""}`);
    ok(Object.keys(ali.alias ?? {}).length === (ali.detalle ?? []).length, "alias_ticker: el mapa y su detalle tienen el mismo número de entradas");
    // Y nadie puede estar a la vez aliaseado y bloqueado: si tiene alias, sus precios vienen
    // del símbolo vivo y el bloqueo lo dejaría sin precios por un motivo que ya no aplica.
    const ambos = Object.keys(ali.alias ?? {}).filter((t) => bloq?.bloqueados?.[t]);
    ok(!ambos.length, `alias_ticker: ninguno está a la vez con alias y bloqueado${ambos.length ? ` — ${ambos.join(", ")}` : ""}`);
  }
}

// ── Las tres trampas de la prueba de portada, como funciones puras ───────────────────────
//
// Cada `ok` de aquí abajo es un defecto que YA existió y que devolvía un CIK creíble y falso.
// Son puras y sin red: si alguien relaja el detector, salta en el acto.
{
  const { simboloEnPortada, ficheroLlevaTicker, tokenDelNombre } = await import("../research/portada.mjs");

  // 1 · La biografía de un consejero NO prueba nada. Con la regla antigua —«cerca de NYSE»—
  //     una SPAC quedó verificada como dueña del ticker ANTM por esta misma frase.
  const bio = "Prior to Surgery Partners Mr. Kretschmer, served as senior vice president, treasurer, and CIO for Anthem, Inc. (NYSE: ANTM). During his over 25-year career at Anthem, Inc.,";
  ok(!simboloEnPortada(bio, "ANTM", "SCP & CO Healthcare Acquisition Co").hay,
    "portada: «Anthem, Inc. (NYSE: ANTM)» en la biografía de un consejero de OTRA empresa no vale como prueba");

  // 2 · La tabla de registro de la §12(b) sí.
  const tabla = "Securities registered pursuant to Section 12(b) of the Act: Title of each class Trading symbol(s) Name of each exchange on which registered Common Stock, Par Value $0.01 ANTM New York Stock Exchange";
  ok(simboloEnPortada(tabla, "ANTM", "Elevance Health, Inc.").hay,
    "portada: el símbolo en la tabla de la §12(b) sí vale");

  // 3 · Un ticker AL FINAL DE UNA FRASE. Excluir el punto del límite de palabra —necesario
  //     para no partir `BF.B`— hacía que «under the symbol “CELG.”» no casara nunca, y Celgene
  //     quedó «sin resolver» teniendo su símbolo escrito en el documento.
  const item5 = "Market for Registrant's Common Equity Our common stock is traded on The Nasdaq Global Select Market under the symbol “CELG.” As of February 2019,";
  ok(simboloEnPortada(item5, "CELG", "CELGENE CORP /DE/").hay,
    "portada: «under the symbol “CELG.”» con el punto pegado sí casa");

  // 4 · Y el emisor que se cita a sí mismo, que es lo que cubre el tramo anterior a 2019.
  ok(simboloEnPortada("Celgene Corporation (NASDAQ: CELG) announced today", "CELG", "CELGENE CORP /DE/").hay,
    "portada: el emisor citándose a sí mismo con su símbolo sí vale");

  // 4bis · Pero citar a OTRA empresa, no. Con la regla antigua —el nombre del emisor «en los
  //        160 caracteres previos»— bastaba una frase así para que **Solo Cup** quedara
  //        verificada como dueña del ticker de H.J. Heinz. Fue la única entrada que ese patrón
  //        produjo en toda la resolución, y era falsa.
  ok(!simboloEnPortada("Solo Cup sells its products to customers including H.J. Heinz Company (NYSE: HNZ) and others", "HNZ", "Solo Cup CO").hay,
    "portada: Solo Cup citando a «H.J. Heinz Company (NYSE: HNZ)» no la hace dueña de HNZ");

  ok(ficheroLlevaTicker("antm-20211231.htm", "ANTM", "Elevance Health, Inc.") && !ficheroLlevaTicker("celgenecorp10-ka.htm", "CELG", "CELGENE CORP /DE/"),
    "portada: el nombre del fichero cuenta cuando el emisor lo bautizó con su ticker, y no cuando no");

  // 5 · El nombre del fichero puede ser la abreviatura del NOMBRE y no del ticker, y así entró
  //     LSI Industries —que cotiza como `LYTS`— como dueña del ticker `LSI`.
  ok(!ficheroLlevaTicker("lsi_10q-123112.htm", "LSI", "LSI INDUSTRIES INC"),
    "portada: «lsi_…» de LSI Industries —que cotiza como LYTS— no prueba que LSI sea su ticker");
  ok(ficheroLlevaTicker("x-20250331.htm", "X", "UNITED STATES STEEL CORP"),
    "portada: un ticker de una letra con la convención de la SEC sí cuenta");
  // El freno del nombre NO alcanza para todo, y conviene que quede escrito: «Wendy's Co» no
  // empieza por TWC, así que esta función no puede rechazar `twc_wr10qq3-12.htm`. A Wendy's lo
  // caza la regla de conflicto de `resolver_cik.mjs` —su CIK es el de `WEN`, que estaba en el
  // índice a la vez que `TWC`—, no el nombre del fichero. Y las iniciales tampoco servirían de
  // regla general: «TOTAL SYSTEM SERVICES INC» da «TSS», que sí es su ticker de verdad.
  ok(ficheroLlevaTicker("twc_wr10qq3-12.htm", "TWC", "Wendy's Co"),
    "portada: el freno del nombre no alcanza a «twc_…» de Wendy's — eso lo resuelve la regla de conflicto, no ésta");
  ok(tokenDelNombre("CELGENE CORP /DE/") === "CELGENE" && tokenDelNombre("The Company Inc") === null,
    "portada: la palabra distintiva del nombre salta los sufijos societarios");
}

// ── Un CIK identifica una EMPRESA, no una ACCIÓN ─────────────────────────────────────────
//
// Los dos casos de abajo produjeron alias equivocados que nada habría delatado: a la clase B de
// Brown-Forman se le habrían dado los precios de la clase A, y a Symantec/NortonLifeLock se les
// habría negado el suyo por confundir un warrant con una clase.
{
  // ⚠️ De `alias_reglas.mjs`, NO de `publicar_resolucion.mjs`: aquél es un script con
  // efectos, e importarlo desde aquí lo EJECUTABA — reescribía los mapas y llamaba a la SEC
  // en medio de un test. Por eso las reglas puras viven en su propio módulo.
  const { elegirVivo, convivieron } = await import("../research/alias_reglas.mjs");
  ok(elegirVivo("BF.B", new Set(["BF-A", "BF-B"])) === "BF-B",
    "alias: BF.B va a su propia clase (BF-B), no a la primera alfabética");
  ok(elegirVivo("NLOK", new Set(["GEN", "GENVR"])) === "GEN",
    "alias: GENVR es un derecho —extensión de GEN— y no compite como acción ordinaria");
  ok(elegirVivo("ESV", new Set(["VAL", "VAL-WT"])) === "VAL",
    "alias: VAL-WT es un warrant y no compite como acción ordinaria");
  ok(elegirVivo("XYZ", new Set(["AAA", "BBB"])) === null,
    "alias: con dos ordinarias distintas y ninguna coincidencia de clase, no se inventa");
  ok(convivieron({ desde: "2010-03-01", hasta: "2022-04-04" }, { desde: "2014-08-07", hasta: "2022-04-04" }),
    "alias: DISCA y DISCK convivieron en el índice — son clases, no una cadena de renombres");
  ok(!convivieron({ desde: "2010-01-06", hasta: "2019-10-18" }, { desde: "2019-11-05", hasta: "2022-11-01" }),
    "alias: SYMC y NLOK se suceden — la misma empresa con dos nombres, y los dos alias valen");
}

// ══ B · HUMO CONTRA LA SEC ════════════════════════════════════════════════════════════════
if (SIN_RED) {
  console.log("\n  B · humo contra la SEC — SALTADO (--sin-red)\n");
} else {
  console.log("\n  B · humo contra la SEC (seis nombres, uno por defecto)\n");
  const { tickerToCik, fundamentalsAsOf, sicSector, PREDECESORES } = await import("../research/edgar.mjs");

  // ── BLACKROCK ANTES DE 2019 ────────────────────────────────────────
  //
  // Un top-25 del índice que estuvo invisible en toda su historia anterior a 2019. La fusión
  // con el CIK predecesor le devolvió el balance, pero no los ingresos: los tags estándar de
  // `BlackRock Finance` no arrancan hasta 2016. Lo que cubre 2007-2022 es
  // `RevenuesExcludingInterestAndDividends`, la línea propia de gestoras y broker-dealers.
  //
  // Va al final de `REV`, así que sólo actúa donde no hay nada mejor — medido: AAPL, JPM, GS y
  // APA no se mueven ni un dígito.
  {
    const cik = await tickerToCik("BLK");
    const f13 = await fundamentalsAsOf(cik, "2013-06-30");
    ok(f13?.revTTM > 5e9 && f13.revTTM < 20e9, `BLK tiene ingresos en 2013 (${f13?.revTTM ? (f13.revTTM / 1e9).toFixed(1) + " B" : "NULO"}, se esperan ~9 B)`);
    const f26 = await fundamentalsAsOf(cik, "2026-06-30");
    ok(f26?.revTTM > 15e9, `BLK sigue teniendo los ingresos de hoy (${f26?.revTTM ? (f26.revTTM / 1e9).toFixed(1) + " B" : "NULO"})`);
  }

  // ── COBERTURA SECTORIAL ────────────────────────────────────────────
  //
  // El sector no entra en el score —los percentiles sectoriales se retiraron— pero sí decide
  // el análisis de SESGO SECTORIAL del backtest, que es el que responde a «¿cuánto de la
  // ventaja es no tener bancos?». Con un tercio del universo sin clasificar —que es como
  // estaba— esa pregunta no se podía contestar.
  //
  // Suelo bajo a propósito: 38 nombres siguen sin sector A PROPÓSITO porque el SIC no los
  // resuelve (ver el comentario de `sicSector`). Lo que este test detecta es que el mapa se
  // ROMPA, no que deje de crecer.
  {
    const { loadSP500Historical: cargarT, membersAsOf: miembrosEn } = await import("../research/universe.mjs");
    const tb = await cargarT();
    if (!tb?.length) aviso("sin tabla de miembros: no se puede medir la cobertura sectorial");
    else {
      const hoy = tb[tb.length - 1].date;
      const ms = miembrosEn(tb, hoy);
      let con = 0, tot = 0;
      for (const k of ms) {
        const c = await tickerToCik(k).catch(() => null); if (!c) continue;
        tot++;
        if (await sicSector(c).catch(() => null)) con++;
      }
      const pct = tot ? (100 * con) / tot : 0;
      ok(pct >= 85, `cobertura sectorial: ${con}/${tot} miembros con sector (${pct.toFixed(0)} %, suelo 85; medido 92)`);
    }
  }

  // ── LAS SERIES CORTADAS TIENEN QUE ESTAR CORTADAS DE VERDAD ───────────────────
  //
  // Cuando una empresa desaparece, el proveedor a veces no deja de servir su símbolo: repite
  // el último cierre indefinidamente. `ANSS` sale a 374,30 el día que Synopsys cerró la
  // compra y sigue a 374,30 hasta hoy; `SIVB` a 0,006 durante 133 barras. Eso NO es una serie
  // ajena: es la buena más un muñón — y el muñón es PEOR que una serie ajena, porque
  // volatilidad cero y retorno cero convierten a la empresa en un activo sin riesgo.
  //
  // Y no sólo ensucia el backtest: el cron en vivo pregunta si la serie LLEGA A HOY para
  // decidir si un nombre se puede comprar. Con el muñón, la respuesta era que sí.
  {
    const { truncarEn, lastBarDate } = await import("../research/prices.mjs");
    const ruta = join(RAIZ, "research", "data", "simbolos_reutilizados.json");
    const bl = existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : null;
    const cortes = Object.entries(bl?.truncados ?? {});
    if (!cortes.length) aviso("no hay ninguna serie cortada: o no las hay, o la auditoría no ha corrido con reglas v4+");
    else {
      const malos = [];
      for (const [t, fecha] of cortes) {
        const ult = await lastBarDate(t).catch(() => null);
        if (truncarEn(t) !== fecha) malos.push(t + ": el mapa dice " + fecha + " y truncarEn dice " + truncarEn(t));
        else if (ult && ult > fecha) malos.push(t + ": cortada en " + fecha + " pero la última barra es " + ult);
      }
      ok(!malos.length, `las ${cortes.length} series cortadas no sirven ni una barra después de su fecha${malos.length ? " — " + malos.join(" · ") : ""}`);
    }
  }

  // ── `OilAndGasRevenue`: la línea de ingresos de las petroleras antes de ASC 606 ────
  //
  // Va la última de la lista ${REV} a propósito, para que sólo actúe donde no hay nada mejor.
  // Sin ella, Apache no tenía NI UN ingreso en 2012-2016 — y esa es la ventana del backtest
  // antiguo. Medido: 13 valores rescatados y CERO desplazados.
  {
    const a = await fundamentalsAsOf(await tickerToCik("APA"), "2012-06-30");
    ok(a?.revTTM > 5e9, `APA tiene ingresos en 2012 vía OilAndGasRevenue (${a?.revTTM ? (a.revTTM / 1e9).toFixed(1) + " B" : "NULO"})`);
    const q = await fundamentalsAsOf(await tickerToCik("PXD"), "2014-06-30");
    ok(q?.revTTM > 1e9, `PXD tiene ingresos en 2014 vía OilAndGasRevenue (${q?.revTTM ? (q.revTTM / 1e9).toFixed(1) + " B" : "NULO"})`);
  }

  // ── LA RECONSTRUCCIÓN DEL RESULTADO DE EXPLOTACIÓN ─────────────────────────
  //
  // `OperatingIncomeLoss` falta en el 22 % del índice y de él cuelgan cuatro de las cinco
  // métricas. Cuando falta se reconstruye DENTRO de la sección de explotación —bruto menos
  // gastos, o ingresos menos coste menos gastos— y la procedencia queda escrita.
  //
  // Lo que este test protege no es tanto que funcione como que NO se degrade a la vía
  // fácil: lo que estas empresas sí etiquetan es `...BeforeIncomeTaxes...`, que es resultado
  // ANTES DE IMPUESTOS. Se midió y se rechazó — 36 pp de dispersión entre sectores —, pero es
  // justo lo que añadiría alguien que viera «falta cobertura» sin leer por qué no está.
  {
    const cik = await tickerToCik("GPC");
    const f = await fundamentalsAsOf(cik, "2026-06-30");
    ok(f?.oiFuente === "bruto-menos-opex", `GPC reconstruye su resultado de explotación desde el margen bruto (fuente: ${f?.oiFuente ?? "NINGUNA"})`);
    // Y el resultado tiene que ser un margen de empresa, no un número cualquiera: un
    // distribuidor de recambios ronda el 4 %. Si sale 40 % o negativo, la resta está mal.
    const opm = f?.oiTTM != null && f?.revTTM > 0 ? (f.oiTTM / f.revTTM) * 100 : null;
    ok(opm != null && opm > 1 && opm < 15, `GPC: el margen reconstruido es creíble (${opm?.toFixed(1)} %, se espera 1-15 %)`);

    // AAPL no debe cambiar de vía: tiene el tag y la reconstrucción no puede pisarlo.
    const fa = await fundamentalsAsOf(await tickerToCik("AAPL"), "2026-06-30");
    ok(fa?.oiFuente === "tag", `AAPL sigue usando el tag propio, no la reconstrucción (fuente: ${fa?.oiFuente})`);
  }


  // ── LA FUSION CON EL CIK PREDECESOR ────────────────────────────────────────────────
  //
  // Cuando una empresa se reorganiza bajo una holding nueva, la SEC le da un CIK NUEVO que
  // solo tiene los ejercicios posteriores. `BLK` apuntaba a un CIK cuyos hechos empiezan en
  // 2023-12-31, asi que BlackRock —un top-25 del indice— estaba sin fundamentales en toda su
  // historia anterior: sin senal, invisible, y sin que fallara nada.
  //
  // El arreglo une los hechos del CIK nuevo con los del predecesor y deja que
  // `fundamentalsAsOf` elija por fecha, que es lo que ya hacia. Este test comprueba que la
  // union SIRVE —no que exista la tabla— pidiendo un ejercicio que solo puede venir del CIK
  // viejo: antes de la fusion, esta misma llamada devolvia null.
  {
    const cik = await tickerToCik("BLK");
    const f = await fundamentalsAsOf(cik, "2021-06-30");
    ok(f?.revTTM > 5e9, `BLK tiene fundamentales en 2021 gracias al CIK predecesor (revTTM ${f?.revTTM ? (f.revTTM / 1e9).toFixed(1) + " B" : "NULO"}) — sin la fusion, BlackRock es invisible antes de 2023`);

    // ⚠️ Y LO QUE NO PUEDE ENTRAR NUNCA EN ESA TABLA.
    //
    // `SNDK` tiene la misma forma —ticker vivo, CIK nuevo sin historia— y el arreglo seria el
    // mismo mecanicamente. Pero no es la misma empresa: el SanDisk del indice 2010-2016 lo
    // compro Western Digital y el de hoy es un spin-off de 2025. Unirlos no reconstruiria una
    // serie, la INVENTARIA. Y la prueba esta en los datos, no en el criterio de nadie: los
    // hechos del viejo (CIK 1000180) acaban el 2016-04-03 y los del nuevo empiezan el
    // 2024-06-28 — ocho anos de vacio. Los de una reorganizacion se SOLAPAN.
    ok(!PREDECESORES["0002023554"], "SNDK NO tiene predecesor declarado: es una reasignacion de simbolo, no una reorganizacion, y unir sus hechos fabricaria una continuidad que nunca existio");
  // ── TODO MIEMBRO ACTUAL TIENE QUE RESOLVER A UN CIK ─────────────────────────
  //
  // Sin CIK no hay fundamentales, luego no hay señal, luego el nombre no sale en ningún
  // aviso: desaparece del sistema entero sin que falle nada. El 2026-08-25 le pasaba a
  // `EA`, `FI` y `DAY` — tres miembros del índice, uno de ellos Electronic Arts.
  //
  // La causa es que `company_tickers.json` NO es una foto completa de lo vivo, aunque se
  // use como si lo fuera: para `EA` el volcado masivo no la trae y en cambio el endpoint
  // de submissions declara `tickers: ["EA"]`. Los huecos se tapan en `MANUAL_CIK`, y este
  // test existe para que el siguiente se vea el día que aparezca y no meses después.
  {
    const { loadSP500Historical: cargar, membersAsOf } = await import("../research/universe.mjs");
    const t0 = await cargar();
    if (!t0?.length) aviso("sin tabla de miembros: no se puede comprobar que todos resuelvan a CIK");
    else {
      const hoy = t0[t0.length - 1].date;
      const miembros = membersAsOf(t0, hoy);
      const sinCik = [];
      for (const t of miembros) {
        const c = await tickerToCik(t).catch(() => null);
        if (!c) sinCik.push(t);
      }
      ok(!sinCik.length, `los ${miembros.length} miembros actuales resuelven a un CIK${sinCik.length ? ` — SIN CIK: ${sinCik.join(", ")} (añádelos a MANUAL_CIK en research/edgar.mjs)` : ""}`);
    }
  }

  }

  // ── MIEMBROS ACTUALES QUE EL MAPA VIVO MANDA A UN CIK SIN HISTORIA ──────────────────
  //
  // El sesgo de supervivencia que cerró §10 entraba por los tickers MUERTOS. Existe la
  // variante simétrica, hacia atrás, y aquello no la cubre: un ticker VIVO cuya empresa de hoy
  // no es la que lo llevaba entonces. Ocurre de dos maneras:
  //
  //   · **Reorganización** — la empresa crea una holding nueva, con CIK nuevo. Es el caso de
  //     `XOM`, que por esto está fijado a mano en `MANUAL_CIK`: el mapa devuelve el CIK de
  //     «ExxonMobil Holdings Corp», que no ha presentado ningún 10-K. Respuesta plausible y
  //     equivocada — no falla: deja a la empresa sin fundamentales y por tanto sin señal.
  //   · **Reasignación** — la empresa murió y otra heredó el símbolo años después. `SNDK` fue
  //     miembro de 2010 a 2016 (SanDisk, comprada por Western Digital) y hoy es el spin-off de
  //     2025, con CIK nuevo. No es la misma empresa ni de lejos.
  //
  // El síntoma común es barato y no cuesta ni una petición extra: un CIK ALTO —asignado hace
  // poco— en un ticker que consta en el índice desde hace años. Los tres conocidos van en la
  // lista; este test existe para que el CUARTO no entre en silencio, que es como entraron
  // estos. Fijarles el CIK correcto es decisión de producción, no de un test.
  //
  // ⚠️ Y SI ALGUIEN VIENE A ARREGLARLO: LAS DOS CLASES PIDEN TRATAMIENTOS OPUESTOS.
  //
  // El arreglo natural es un mapa con TRAMOS POR FECHA —antes del corte la CIK antigua,
  // después la nueva—, que hoy no existe: `mapa` es {ticker: "CIK"} plano y `tickerToCik`
  // no recibe fecha (28 llamadas en 26 ficheros, varias en crons de producción).
  //
  //   · En BLK y APA empalmar es CORRECTO. Es la misma empresa con holding nueva, la serie de
  //     fundamentales es económicamente continua, y el empalme reconstruye una historia que
  //     existió de verdad.
  //   · En SNDK empalmar es FALSIFICAR. El SanDisk de 2010-2016 lo absorbió Western Digital;
  //     el de 2025 es un spin-off distinto. Unirlos fabrica una continuidad que nunca hubo, y
  //     eso es PEOR que el hueco: un hueco se ve y se cuenta, una serie inventada no.
  //
  // O sea que el tramo por fecha resuelve los tres mecánicamente y sólo dos de ellos
  // semánticamente. Si se implementa, SNDK necesita quedar marcado como «dos empresas que
  // comparten símbolo», no como una con historia larga.
  {
    const { loadSP500Historical } = await import("../research/universe.mjs");
    const tabla = await loadSP500Historical();
    if (!tabla?.length) aviso("sin tabla de miembros: no se puede buscar tickers vivos con CIK sin historia");
    else {
      const fotos = tabla.filter((f) => f.date >= "2010-01-01");
      const primera = new Map();
      for (const f of fotos) for (const k of f.tickers) if (!primera.has(k)) primera.set(k, f.date);
      // Los cinco conocidos, y los cinco son de las DOS clases que piden tratamientos opuestos:
      //
      //   · REORGANIZACIÓN (misma empresa, holding nueva) → se fusiona con el predecesor:
      //     `BLK` y `APA`. Los hechos de las dos entidades SE SOLAPAN.
      //   · REASIGNACIÓN (otra empresa heredó el símbolo) → NO se fusiona, porque empalmarlas
      //     fabricaría una continuidad que nunca existió: `SNDK`, `CEG` y `Q`.
      //
      // `CEG` y `Q` los encontró este mismo test el 2026-09-01, al corregir la fuente de
      // miembros — que es exactamente para lo que se escribió. Los dos tienen la firma del
      // símbolo reasignado: dos periodos en el índice separados por un hueco enorme.
      //
      //   CEG  1996→2012-03-02 (Constellation Energy Group, comprada por Exelon)
      //        2022-02→hoy     (Constellation Energy Corp, ex-«Constellation Newholdco»)
      //   Q    2000→2011-03-23 (Qwest, comprada por CenturyLink)
      //        2025-11→hoy     (Qnity Electronics, ex-«Novus SpinCo 1»)
      //
      // Ninguno contamina hoy: sus CIK actuales sólo tienen fundamentales recientes y sus
      // series de precios empiezan tarde, así que en las fechas antiguas quedan fuera del panel
      // en vez de entrar con datos ajenos. Pero son la variante que la auditoría de símbolos NO
      // mira —sólo audita a los que SALIERON del índice, y éstos están dentro— así que si algún
      // proveedor llegara a servir la historia vieja bajo el símbolo actual, nadie lo vería.
      const CONOCIDOS = new Set(["SNDK", "BLK", "APA", "CEG", "Q"]);
      const nuevos = [];
      for (const t of fotos[fotos.length - 1].tickers) {
        const cik = await tickerToCik(t).catch(() => null);
        if (!cik) continue;
        if (parseInt(cik, 10) > 1800000 && primera.get(t) < "2019-01-01" && !CONOCIDOS.has(t)) {
          nuevos.push(`${t} (CIK ${cik}, en el índice desde ${primera.get(t)})`);
        }
      }
      ok(!nuevos.length, `ningún miembro actual NUEVO con CIK reciente e historia antigua (conocidos, sin arreglar: ${[...CONOCIDOS].join(", ")})${nuevos.length ? ` — APARECIDO: ${nuevos.join(" · ")}` : ""}`);
    }
  }

  /** Cada caso reproduce UNO de los defectos encontrados. El comentario dice cuál. */
  const CASOS = [
    { t: "AAPL", cik: "0000320193", que: "TTM de doce meses seguidos (sumaba 4 trimestres sueltos)",
      comprueba: (f) => f.revTTM > 3e11 && f.ocfTTM > 5e10 && f.ocfTTM < 2.5e11 },
    { t: "JPM", cik: "0000019617", que: "flujo de explotación creíble (salía en −729 B)",
      comprueba: (f) => f.ocfTTM != null && Math.abs(f.ocfTTM) < 5e11 },
    { t: "AMZN", cik: "0001018724", que: "margen bruto del ejercicio en curso (usaba el de 2009)",
      comprueba: (f) => f.gpTTM > 0 && f.revTTM > 0 && f.gpTTM / f.revTTM > 0.25 && f.gpTTM / f.revTTM < 0.85 },
    { t: "CVS", cik: "0000064803", que: "la deuda no es cero por no encontrar el tag",
      comprueba: (f) => f.debt != null && f.debt > 1e10 },
    { t: "ESS", cik: "0000920522", que: "un REIT declara sus ingresos TOTALES, no una rebanada",
      comprueba: (f) => f.revTTM > 1e9 },
    { t: "SAP", cik: "0001000184", que: "una extranjera se lee en IFRS y en su moneda",
      comprueba: (f) => f.currency === "EUR" && f.revTTM > 1e10 && f.precioComparable === false },
  ];

  let red = true;
  for (const c of CASOS) {
    let f = null;
    try { f = await fundamentalsAsOf(c.cik, new Date().toISOString().slice(0, 10)); }
    catch { red = false; break; }
    if (!f) { aviso(`${c.t}: sin fundamentales (¿SEC no responde?) — se salta`); continue; }
    ok(c.comprueba(f), `${c.t} · ${c.que}`);
    // Y una invariante que vale para todos: si hay TTM, su cierre tiene que ser reciente.
    if (f.periodos?.rev) {
      const dias = Math.round((Date.now() - Date.parse(f.periodos.rev)) / 86400000);
      ok(dias < 500, `${c.t} · el cierre de ingresos (${f.periodos.rev}) tiene ${dias} días — más de 500 es un dato muerto`);
    }
  }
  if (!red) aviso("la SEC no responde: la parte B se salta entera en vez de romper el build");

  // El mapa de la SEC también resuelve por ticker, y es lo que usa producción.
  try {
    const cik = await tickerToCik("AAPL");
    ok(cik === "0000320193", `tickerToCik("AAPL") = ${cik}`);
  } catch { aviso("tickerToCik no pudo consultarse"); }
}

console.log(pass && !fail ? `\n✓ datos: ${pass} passed, 0 failed${avisos ? `, ${avisos} avisos` : ""}\n`
                          : `\n✖ datos: ${pass} passed, ${fail} failed${avisos ? `, ${avisos} avisos` : ""}\n`);
process.exit(fail ? 1 : 0);
