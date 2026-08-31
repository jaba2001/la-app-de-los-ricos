// ─────────────────────────────────────────────────────────────────────────────
// ¿ES ESTE TICKER DE ESTA EMPRESA? — la prueba de la portada
//
// Comprobar que un CIK presentaba informes durante el periodo en que el ticker estuvo en el
// índice descarta a los impostores burdos (una minera de oro, una empresa que cotiza desde
// 2023), pero NO descarta al impostor plausible: Walt Disney presentaba 10-K en el mismo
// periodo que AmerisourceBergen, y en sus 10-K aparece «ABC» porque es dueña de la cadena.
//
// La prueba que sí decide es la PORTADA: desde la Exchange Act §12(b), todo 10-K/10-Q lleva en
// su primera página el símbolo bajo el que cotiza **el emisor**. Esa mención la escribe la
// empresa sobre sí misma; Disney nunca escribe «ABC» ahí.
//
// ⚠️ TRES DEFECTOS QUE ESTE FICHERO YA TUVO, todos encontrados midiendo y todos silenciosos:
//
//   1. **Cortar el documento por bytes de HTML.** Con 200 KB parecía de sobra para una portada.
//      No lo es: un 10-K moderno en XBRL en línea gasta esos 200 KB en la cabecera `ix:` y en
//      CSS antes de llegar al texto. El 10-K de Elevance ocupa 5,4 MB y su portada está en el
//      carácter 79.276 del texto plano, pero los primeros 200 KB de HTML sólo rinden 26.833
//      caracteres. Meta, Celgene y Elevance fallaron por esto, no por sus datos.
//      → Ahora se corta por longitud de TEXTO, después de quitar etiquetas.
//
//   2. **Aceptar la cercanía a «NYSE» como prueba.** No lo es: `Anthem, Inc. (NYSE: ANTM)` es
//      como CUALQUIER documento cita a CUALQUIER empresa. Con esa regla, la SPAC «SCP & CO
//      Healthcare Acquisition» quedó verificada como dueña del ticker ANTM porque la biografía
//      de un consejero suyo mencionaba dónde había trabajado antes.
//      → Ahora sólo cuentan dos patrones, y los dos hablan del emisor: la tabla de registro de
//        la §12(b), y `Nombre-del-emisor (MERCADO: TICKER)` con el nombre pegado al símbolo.
//
//   3. **Mirar sólo `filings.recent`.** Trae los ~1.000 documentos más recientes, así que en una
//      empresa que presenta mucho no llega ni a cinco años atrás. Meta no ofreció ni un solo
//      informe en 2012-2021 y el CIK correcto se descartó por «sin portada legible».
//      → Ahora se fusiona `filings.recent` con los ficheros de archivo de `filings.files[]`.
// ─────────────────────────────────────────────────────────────────────────────
const UA = { "User-Agent": "Scora Research contact@scora.app" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Formularios que llevan portada con símbolo. */
const CON_PORTADA = /^(10-K|10-Q|20-F|40-F)/;

/** Un ticker sólo trae letras, punto y guion, así que basta con neutralizar el punto. */
const comoRegex = (t) => t.split(".").join("[.]");

/** Quita etiquetas y entidades; el resultado es lo que un humano vería en la página. */
const aTextoPlano = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[\s ]+/g, " ");

/**
 * Todas las presentaciones periódicas de un CIK, fusionando `filings.recent` con los ficheros
 * de archivo. Sin esa fusión hay falsos negativos en toda empresa que presente mucho (defecto 3).
 */
export async function periodicasTodas(sub, { pausa = 220 } = {}) {
  const bloques = [sub?.filings?.recent ?? {}];
  for (const f of sub?.filings?.files ?? []) {
    await sleep(pausa);
    try {
      const r = await fetch(`https://data.sec.gov/submissions/${f.name}`, { headers: UA });
      if (r.ok) bloques.push(await r.json());
    } catch { /* un archivo ilegible no invalida los demás */ }
  }
  const out = [];
  for (const b of bloques) {
    for (let i = 0; i < (b.filingDate?.length ?? 0); i++) {
      if (!CON_PORTADA.test(b.form[i] ?? "")) continue;
      out.push({
        fecha: b.filingDate[i],
        forma: b.form[i],
        acc: String(b.accessionNumber[i] ?? "").split("-").join(""),
        doc: b.primaryDocument?.[i] ?? "",
      });
    }
  }
  return out;
}

/** Filtra por periodo. */
export const enPeriodo = (lista, desde, hasta) => lista.filter((x) => x.fecha >= desde && x.fecha <= hasta);

/** Texto plano del documento, cortado por LONGITUD DE TEXTO y no de HTML (defecto 1). */
async function portadaDe(cik, acc, doc, { maxBytes = 14_000_000, maxTexto = 1_200_000 } = {}) {
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${doc}`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) return null;
  const html = (await r.text()).slice(0, maxBytes);
  return aTextoPlano(html).slice(0, maxTexto);
}

/** Palabra distintiva del nombre del emisor, para exigir que el símbolo hable DE ÉL. */
export function tokenDelNombre(nombre) {
  const RUIDO = new Set(["THE", "CORP", "CORPORATION", "INC", "CO", "COMPANY", "LTD", "LIMITED",
    "PLC", "LLC", "LP", "HOLDINGS", "HOLDING", "GROUP", "TRUST", "NEW", "AND", "OF", "CLASS"]);
  for (const w of String(nombre ?? "").toUpperCase().split(/[^A-Z0-9]+/)) {
    if (w.length >= 4 && !RUIDO.has(w)) return w;
  }
  return null;
}

/** La tabla de registro de la §12(b): donde el emisor declara su símbolo desde 2019. */
const TABLA_12B = /Trading [Ss]ymbol|Symbol\(s\)|Ticker [Ss]ymbol/;
/** La fórmula del Item 5, que existe desde mucho antes que la tabla. */
const ITEM_5 = /under the (?:trading |ticker )?symbols?[^A-Za-z0-9]{0,8}$/i;
/** Primera persona: lo que distingue «nuestras acciones» de las de una empresa citada. */
const PRIMERA_PERSONA = /\b(our|the Company's|the Company&#146;s|the Registrant's|Registrant&#146;s|we )\b/i;
/** Cita de mercado: `(NASDAQ: CELG)`. */
const CITA_MERCADO = /\((?:NYSE|NASDAQ|Nasdaq|NYSE American|NYSE Amex|AMEX|CBOE)[^)]{0,12}$/;

/**
 * Límite de palabra para un ticker, con la trampa que ya coló una vez.
 *
 * Excluir el punto del límite —necesario para no partir `BF.B`— hacía que un ticker **al final
 * de una frase** no casara jamás: en `under the symbol “CELG.”` el carácter siguiente es un
 * punto, y con eso Celgene quedó «sin resolver» teniendo su símbolo escrito en el documento.
 * La regla correcta: no puede haber alfanumérico pegado, y un punto sólo estorba si a su vez
 * lleva alfanumérico detrás (que es el caso real de `BF.B`).
 */
const limite = (t) => new RegExp(`(?<![A-Za-z0-9.-])(${comoRegex(t)})(?![A-Za-z0-9-]|[.][A-Za-z0-9])`, "g");

/**
 * ¿Bautizó el emisor su propio documento con el TICKER? La SEC recomienda `{ticker}-{fecha}.htm`
 * y la convención es masiva desde 2010: `antm-20211231.htm`, `sial-20141231x10k.htm`.
 *
 * ⚠️ ES LA PRUEBA MÁS DÉBIL DE LAS TRES, y hay que usarla como último recurso. Un emisor
 * también bautiza sus ficheros con la abreviatura de su NOMBRE, que no tiene por qué ser su
 * símbolo, y eso produjo dos CIK equivocados y creíbles:
 *
 *   · `twc_wr10qq3-12.htm` — es **Wendy's**, «The Wendy's Company». El ticker de Time Warner
 *     Cable acabó apuntando a una cadena de hamburguesas.
 *   · `lsi_10q-123112.htm` — es **LSI Industries**, que cotiza como `LYTS`.
 *
 * De ahí el segundo freno: se rechaza si el ticker coincide con la primera palabra del nombre
 * del emisor, que es como se cuelan las abreviaturas de nombre. (El primero —probarla sólo
 * cuando ningún candidato pasa una prueba de texto— vive en `resolver_cik.mjs`, porque depende
 * de conocer a todos los candidatos.)
 */
export function ficheroLlevaTicker(doc, ticker, nombre) {
  const base = String(doc ?? "").toLowerCase();
  const primeraPalabra = String(nombre ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)[0] ?? "";
  if (primeraPalabra && primeraPalabra === ticker.toUpperCase()) return false;
  for (const t of [ticker, ticker.split(".").join("-"), ticker.split(".").join("")]) {
    if (new RegExp(`^${comoRegex(t.toLowerCase())}[-_.]`).test(base)) return true;
  }
  return false;
}

/**
 * ¿Aparece `ticker` en el documento como símbolo DEL EMISOR?
 *
 * Tres patrones, y los tres hablan del emisor sobre sí mismo (defecto 2):
 *   · **tabla**  — el símbolo a menos de 350 caracteres de «Trading Symbol(s)». Sólo desde 2019.
 *   · **item5**  — «our common stock … under the symbol “X”», la fórmula del Item 5. Se exige la
 *                  primera persona delante, que es lo que separa «nuestras acciones» de las de
 *                  una empresa citada de pasada.
 *   · **cita**   — `Nombre-del-emisor (MERCADO: TICKER)`, con el nombre pegado al símbolo.
 *
 * Lo que NO cuenta es la mera cercanía a «NYSE»: `Anthem, Inc. (NYSE: ANTM)` es como cualquier
 * documento cita a cualquier empresa, y con esa regla una SPAC quedó verificada como dueña de
 * ANTM porque la biografía de un consejero suyo decía dónde había trabajado antes.
 */
export function simboloEnPortada(texto, ticker, nombre) {
  if (!texto) return { hay: false, motivo: "no se pudo leer el documento" };
  // La SEC escribe las clases con guion (BF-B) donde el índice usa punto (BF.B).
  const alt = [...new Set([ticker, ticker.split(".").join("-"), ticker.split(".").join(" ")])];
  const token = tokenDelNombre(nombre);
  let visto = false;

  for (const t of alt) {
    const re = limite(t);
    let m;
    while ((m = re.exec(texto)) !== null) {
      visto = true;
      const antes = texto.slice(Math.max(0, m.index - 350), m.index);
      if (TABLA_12B.test(antes + texto.slice(m.index, m.index + 350))) {
        return { hay: true, patron: "tabla", motivo: "símbolo en la tabla de registro de la §12(b)" };
      }
      if (ITEM_5.test(antes) && PRIMERA_PERSONA.test(antes.slice(-220))) {
        return { hay: true, patron: "item5", motivo: "el emisor declara su símbolo en el Item 5" };
      }
      // ⚠️ EL NOMBRE TIENE QUE ESTAR PEGADO AL PARÉNTESIS, no «cerca».
      //
      // La primera versión pedía el nombre del emisor en los 160 caracteres previos, y el
      // nombre del emisor aparece constantemente en su propio documento: bastaba una frase
      // como «Solo Cup vende a H.J. Heinz Company (NYSE: HNZ)» para que **Solo Cup** quedara
      // verificada como dueña del ticker de Heinz. Fue la ÚNICA entrada que este patrón
      // produjo en toda la resolución, y era falsa.
      //
      // Quien escribe `X (NYSE: TIC)` pone el nombre justo delante del paréntesis. Con 45
      // caracteres, «Celgene Corporation (NASDAQ: CELG)» sigue casando y «…a H.J. Heinz
      // Company (NYSE: HNZ)» ya no, porque ahí lo pegado es Heinz y no el emisor.
      const iParen = antes.lastIndexOf("(");
      const pegado = iParen > 0 ? antes.slice(Math.max(0, iParen - 45), iParen) : "";
      if (token && CITA_MERCADO.test(antes) && pegado.toUpperCase().includes(token)) {
        return { hay: true, patron: "cita", motivo: "el emisor se cita a sí mismo con su símbolo" };
      }
    }
  }
  return {
    hay: false,
    motivo: visto ? "el símbolo aparece, pero no como símbolo del emisor" : "el símbolo no aparece en el documento",
  };
}

/**
 * Prueba completa sobre un conjunto de presentaciones ya listadas: descarga hasta `intentos`
 * documentos y responde si alguno declara el ticker como propio.
 */
export async function tickerEsDe(cik, ticker, nombre, lista, { intentos = 4, pausa = 260, soloFichero = false, sinFichero = false } = {}) {
  const cands = lista.filter((x) => x.doc && /[.]html?$/i.test(x.doc));
  if (!cands.length) return { ok: false, motivo: "sin informes con portada legible", probadas: 0 };

  // Gratis y sin descargar nada, pero es la prueba más débil: por eso el que llama decide
  // cuándo se usa, y `resolver_cik.mjs` la deja para cuando ningún candidato pasa una de texto.
  if (!sinFichero) {
    const bautizado = cands.find((c) => ficheroLlevaTicker(c.doc, ticker, nombre));
    if (bautizado) {
      return { ok: true, patron: "fichero", motivo: `el emisor nombra su propio documento «${bautizado.doc}» · ${bautizado.forma} de ${bautizado.fecha}`, probadas: 0 };
    }
  }
  if (soloFichero) return { ok: false, motivo: "ningún documento lleva el ticker en su nombre", probadas: 0 };

  // Se prefiere el 10-K sobre todo lo demás y, dentro de él, el más reciente. Ojo: `10-K/A` es
  // una ENMIENDA —normalmente sólo la Parte III— y no trae ni portada completa ni Item 5, así
  // que ordenarla junto a los 10-K hacía que se probaran cinco enmiendas y ningún informe.
  const rango = (f) => (f === "10-K" || f === "20-F" || f === "40-F" ? 0 : f === "10-Q" ? 1 : 2);
  cands.sort((a, b) => (rango(a.forma) - rango(b.forma)) || b.fecha.localeCompare(a.fecha));

  let ultimo = "sin coincidencia en los documentos leídos";
  let probadas = 0;
  for (const c of cands.slice(0, intentos)) {
    await sleep(pausa);
    let texto = null;
    try { texto = await portadaDe(cik, c.acc, c.doc); } catch { continue; }
    probadas++;
    const v = simboloEnPortada(texto, ticker, nombre);
    if (v.hay) return { ok: true, patron: v.patron, motivo: `${v.motivo} · ${c.forma} de ${c.fecha}`, probadas };
    ultimo = v.motivo;
  }
  return { ok: false, motivo: ultimo, probadas };
}

/**
 * JERARQUÍA DE EVIDENCIA — porque una sola prueba no basta, y esto se descubrió fallando.
 *
 * `tickerEsDe` restringido al periodo en el índice produce **falsos negativos** por dos motivos
 * que no tienen nada que ver con que el CIK esté mal:
 *
 *   · La tabla histórica de miembros lleva el ticker MODERNO retroproyectado. `ATGE` figura como
 *     miembro en 2010-2012, pero en esas fechas la empresa cotizaba como `DV` (DeVry) y su
 *     portada de entonces dice «DV». El CIK 730464 es correcto: sus `formerNames` encadenan
 *     DEVRY INC → DEVRY EDUCATION GROUP → Adtalem Global Education → Covista Inc.
 *   · Un cambio de nombre reciente aún no ha llegado a ningún informe. `VMRK` (Equity
 *     Residential, renombrada el 2026-08-12) no tiene todavía un 10-K que diga «VMRK».
 *
 * De ahí tres niveles, y el que se alcance se escribe en el resultado en vez de esconderse tras
 * un booleano:
 *
 *   **A** — el emisor declara el símbolo DENTRO del periodo en el índice. Prueba directa.
 *   **B** — lo declara en algún otro momento de su historia. Prueba de que el ticker es de esa
 *           entidad, aunque no en esas fechas.
 *   **C** — ningún documento lo declara. NO se acepta automáticamente: va a revisión a mano.
 */
export async function pruebaPortada(cik, ticker, nombre, desde, hasta, todas, opts = {}) {
  const dentro = await tickerEsDe(cik, ticker, nombre, enPeriodo(todas, desde, hasta), opts);
  if (dentro.ok) return { nivel: "A", motivo: dentro.motivo };
  const jamas = await tickerEsDe(cik, ticker, nombre, todas, opts);
  if (jamas.ok) return { nivel: "B", motivo: `fuera del periodo en el índice — ${jamas.motivo}` };
  return { nivel: "C", motivo: dentro.probadas ? dentro.motivo : jamas.motivo };
}

/**
 * LOS NOMBRES QUE ESA EMPRESA USABA DURANTE EL PERIODO EN EL ÍNDICE, y no todos los que ha
 * tenido nunca.
 *
 * ⚠️ Sin esta distinción, la corroboración eligió **CSC Holdings LLC** como dueña del ticker
 * `CVC`: entre sus `formerNames` está «CABLEVISION SYSTEMS CORP», que dejó de usar en **1998**
 * —doce años antes del periodo—, porque ese nombre se lo quedó la matriz. La que cotizaba como
 * CVC en 2010-2016 era la matriz (CIK 1053112); CSC Holdings es la filial que emite deuda.
 * Comparar contra un nombre que la empresa no llevaba entonces es comparar contra otra empresa.
 *
 * `formerNames` trae `from`/`to`; el nombre ACTUAL rige desde el último `to` en adelante.
 */
export function nombresVigentesEn(sub, desde, hasta) {
  const fn = sub?.formerNames ?? [];
  const out = [];
  let ultimoFin = null;
  for (const f of fn) {
    const a = String(f.from ?? "").slice(0, 10) || "0000-00-00";
    const b = String(f.to ?? "").slice(0, 10) || "9999-99-99";
    if (a <= hasta && b >= desde) out.push(f.name);
    if (!ultimoFin || b > ultimoFin) ultimoFin = b;
  }
  // El nombre actual vale si empezó antes de que el ticker saliera del índice.
  if (!fn.length || (ultimoFin && ultimoFin <= hasta)) out.push(sub?.name ?? "");
  return out.filter(Boolean);
}

/** ¿Se parecen dos nombres de empresa lo bastante como para ser el mismo? */
export function mismoNombre(a, b) {
  const RUIDO = /\b(THE|CORP|CORPORATION|INC|CO|COMPANY|LTD|LIMITED|PLC|LLC|LP|HOLDINGS?|GROUP|TRUST|NEW|AND|OF|CLASS|COMMON|STOCK)\b/g;
  const norm = (x) => String(x ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(RUIDO, " ").split(/\s+/).filter(Boolean);
  const A = norm(a), B = norm(b);
  if (!A.length || !B.length) return 0;
  const enB = new Set(B);
  return A.filter((w) => enB.has(w)).length / Math.max(A.length, B.length);
}

/**
 * ⚠️ DEVUELVE TRES COSAS, NO DOS, y confundirlas borró dieciséis empresas del mapa.
 *
 * La primera versión devolvía `null` tanto para «esta empresa no existe» (404) como para
 * «no he podido preguntar» (429, red, timeout). Quien llama anotaba «sin submissions» y
 * descartaba al candidato — un hecho negativo que nadie había observado.
 *
 * El 2026-08-31 eso hizo que `MRO` quedara «sin resolver»: se descartó el CIK 0000101778 por
 * «sin submissions» cuando ese CIK es MARATHON OIL CORP y tiene 1.001 formularios. Y con él
 * cayeron quince más que ya estaban publicados: ABC, ABMD, ADS, AET, ALXN, ANSS, ANTM, MXIM,
 * MYL, NBL, NFX, NLOK, NLSN, PEAK y SEE. Todos habían sido `verificado/A` en la corrida
 * anterior; ninguna empresa había cambiado, sólo la suerte de las peticiones.
 *
 * Es el mismo defecto que `ultimoInforme` tenía en la auditoría de símbolos y que allí bloqueó
 * a Avon: **«no he podido mirar» valiendo como «no hay»**.
 *
 * Devuelve el JSON, `null` si la SEC dice claramente que no existe (404), o `NO_COMPROBADO`
 * si no se pudo averiguar. Quien llama TIENE que distinguir el tercero.
 */
export const NO_COMPROBADO = Symbol("submissions: no se pudo comprobar");

export async function submissions(cik) {
  for (let intento = 0; intento < 4; intento++) {
    try {
      const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: UA });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;                 // la SEC dice que no existe: es una respuesta
      // 429 y 5xx son «ahora no»: se espera y se reintenta, con esperas crecientes.
      await new Promise((ok) => setTimeout(ok, 700 * (intento + 1)));
    } catch {
      await new Promise((ok) => setTimeout(ok, 700 * (intento + 1)));
    }
  }
  return NO_COMPROBADO;
}
