// ─────────────────────────────────────────────────────────────────────────────
// LAS CARTERAS DE LOS GRANDES GESTORES (13F-HR)
//
// Quien gestiona más de 100 M$ en valores estadounidenses tiene que declarar sus posiciones
// largas cada trimestre. Esto las lee, las traduce de CUSIP a ticker con `research/data/
// cusip_ticker.json` y —lo que de verdad aporta— COMPARA DOS TRIMESTRES: qué abrió, qué cerró,
// qué reforzó y qué recortó. La foto de un trimestre suelto es un dato; el cambio es una noticia.
//
// ⚠️ CUATRO COSAS QUE ESTO **NO** ES, y que conviene decir antes de enseñar un número:
//
//   1. **NO ES ACTUALIDAD.** El plazo legal son 45 días desde el cierre del trimestre, y se
//      cumple hasta el último. Lo que se lee hoy es lo que había hace entre 45 y 135 días. Se
//      publica el PERIODO, nunca «la cartera de X» a secas.
//   2. **NO ES LA CARTERA COMPLETA.** El 13F sólo cubre valores 13(f) —renta variable
//      estadounidense cotizada y poco más—. Sin cortos, sin bonos, sin efectivo, sin extranjero,
//      sin lo que tengan fuera del vehículo declarante. Un gestor con el 60 % en bonos aparece
//      aquí como si estuviera 100 % en bolsa.
//   3. **UNA OPCIÓN NO ES UNA ACCIÓN.** «Tiene 500 M$ de NVDA» es lo contrario de lo que parece
//      si son PUTS. `parse13F` las separa y aquí sólo se cuentan acciones.
//   4. **LAS ENMIENDAS RESTITUYEN.** Un `13F-HR/A` puede reemplazar por completo al original.
//      Se coge la presentación MÁS RECIENTE de cada periodo, no la primera que aparece.
//
//   node --experimental-strip-types --no-warnings research/carteras13f.mjs
//   node --experimental-strip-types --no-warnings research/carteras13f.mjs --gestores 3
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse13F, ficheroDeTabla, retrasoDias, periodoISO, escalaDeValor } from "../lib/parse13f.ts";
import { loadSP500Historical, membersAsOf, snapshotDate } from "./universe.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(AQUI, "out");
const UA = { "User-Agent": "scora-research alealvarado804@gmail.com", "Accept-Encoding": "gzip, deflate" };
const pausa = () => new Promise((r) => setTimeout(r, 130));
const traer = async (u, comoJson = false) => {
  const r = await fetch(u, { headers: UA });
  await pausa();
  if (!r.ok) return null;
  return comoJson ? r.json() : r.text();
};

/**
 * Gestores conocidos, con su CIK. El nombre que se publica sale de la PROPIA presentación, no de
 * esta lista: si un CIK estuviera mal, se vería al instante en vez de publicarse una cartera con
 * la etiqueta equivocada.
 */
const GESTORES = [
  ["Berkshire Hathaway", "0001067983"],
  ["Bridgewater Associates", "0001350694"],
  ["Renaissance Technologies", "0001037389"],
  ["Pershing Square", "0001336528"],
  ["Tiger Global", "0001167483"],
  ["Duquesne Family Office", "0001536411"],
];

const iG = process.argv.indexOf("--gestores");
const CUANTOS = iG >= 0 ? Number(process.argv[iG + 1]) : GESTORES.length;
if (!Number.isInteger(CUANTOS) || CUANTOS < 1) {
  console.error(`\n  ⛔ --gestores tiene que ser un entero ≥ 1, llegó "${process.argv[iG + 1]}".\n`);
  process.exit(2);
}

// ── El mapa CUSIP → ticker ───────────────────────────────────────────────────────────────
const RUTA_MAPA = join(AQUI, "data", "cusip_ticker.json");
if (!existsSync(RUTA_MAPA)) {
  console.error(`\n  ⛔ falta ${RUTA_MAPA}. Córrelo antes:  node ... research/mapa_cusip.mjs\n`);
  process.exit(1);
}
const MAPA = JSON.parse(readFileSync(RUTA_MAPA, "utf8"));
const cusipATicker = Object.fromEntries(Object.entries(MAPA.mapa).map(([c, v]) => [c, v.ticker]));
const tabla = await loadSP500Historical();
const universo = new Set(membersAsOf(tabla, snapshotDate(tabla)));
console.log(`\n  CARTERAS 13F\n  mapa CUSIP: ${Object.keys(cusipATicker).length} · universo: ${universo.size}`);

/** Las dos presentaciones más recientes, una por periodo, quedándose con la enmienda si la hay. */
async function presentaciones(cik) {
  const s = await traer(`https://data.sec.gov/submissions/CIK${cik}.json`, true);
  const r = s?.filings?.recent;
  if (!r?.form) return { nombre: null, lista: [] };

  // ⚠️ Se recorre TODO y se agrupa por periodo quedándose con la fecha de presentación más
  // alta. Coger «las dos primeras 13F-HR» daría el original y su enmienda como si fueran dos
  // trimestres distintos, y la comparación saldría toda a cero.
  const porPeriodo = new Map();
  // ⚠️ `13F-NT` ES UN AVISO, NO UNA CARTERA: significa «mis valores los declara otro gestor».
  // Excluirlo es correcto, pero CALLARLO no: Pershing Square presentó un NT para 2026-06-30 y sin
  // esta nota su última cartera (2026-03-31) aparecía junto a las de Q2 de los demás, como si
  // fueran retrasados. Una ausencia con motivo contada como un trimestre que falta.
  const avisos = [];
  for (let k = 0; k < r.form.length; k++) {
    const forma = String(r.form[k]);
    const per = r.reportDate?.[k] ?? null;
    if (!per) continue;
    if (/^13F-NT(\/A)?$/.test(forma)) { avisos.push({ periodo: per, presentado: r.filingDate[k] }); continue; }
    if (!/^13F-HR(\/A)?$/.test(forma)) continue;
    const cand = { acc: r.accessionNumber[k], presentado: r.filingDate[k], periodo: per, enmienda: forma.endsWith("/A") };
    const previo = porPeriodo.get(per);
    if (!previo || cand.presentado > previo.presentado) porPeriodo.set(per, cand);
  }
  const lista = [...porPeriodo.values()].sort((a, b) => (a.periodo < b.periodo ? 1 : -1)).slice(0, 2);
  // Un aviso POSTERIOR a la última cartera explica por qué no hay nada más reciente.
  const ultima = lista[0]?.periodo ?? "";
  const avisoPosterior = avisos.filter((a) => a.periodo > ultima).sort((a, b) => (a.periodo < b.periodo ? 1 : -1))[0] ?? null;
  return { nombre: s?.name ?? null, lista, avisoPosterior };
}

/** Descarga y parsea UNA presentación. */
async function leer(cik, p) {
  const acc = p.acc.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}`;
  const idx = await traer(`${base}/index.json`, true);
  const nombres = (idx?.directory?.item ?? []).map((x) => x.name);
  // ⚠️ El fichero de posiciones NO SE LLAMA IGUAL en ningún declarante: `56757.xml`,
  // `form13fInfoTable.xml`, `infotable.xml`, `renaissance13Fq22026_holding.xml`. Por eso se elige
  // por contenido probable y no por un nombre fijo.
  const fichero = ficheroDeTabla(nombres);
  if (!fichero) return { error: `sin fichero de tabla entre ${nombres.length} (${nombres.slice(0, 4).join(", ")})` };
  const xml = await traer(`${base}/${fichero}`);
  if (!xml) return { error: `no se pudo descargar ${fichero}` };
  const info = parse13F(xml, p.periodo);
  return { info, fichero };
}

/**
 * Suma las filas del mismo valor.
 *
 * ⚠️ UN 13F LISTA EL MISMO VALOR VARIAS VECES, una por cuenta o gestor con discreción. Berkshire
 * declara **Apple en DOCE filas** (GEICO, BNSF, National Indemnity…), Coca-Cola en diez, Bank of
 * America en ocho. Sin sumarlas, el ranking decía que la primera posición era American Express
 * con 50 B$ —su fila mayor— cuando Apple suma 65,9 B$ entre las suyas. El top 5 salía con AAPL
 * repetido dos veces y la primera posición equivocada.
 *
 * `filas` se conserva porque es la señal de que esto ocurrió: si alguien ve `filas: 12` sabe que
 * la cifra es una suma y no un dato suelto.
 */
function agregarPorTicker(posiciones) {
  const acc = new Map();
  for (const p of posiciones) {
    const a = acc.get(p.ticker) ?? { ticker: p.ticker, valor: 0, cantidad: 0, filas: 0 };
    a.valor += p.valor ?? 0;
    a.cantidad += p.cantidad ?? 0;
    a.filas++;
    acc.set(p.ticker, a);
  }
  const filas = [...acc.values()].sort((a, b) => b.valor - a.valor);

  // El guardián `variantes_identicas` detecta entidades repetidas, pero se salta las listas de
  // más de 40 hermanos por considerarlas tablas de datos — y Bridgewater tiene 357 nombres. O sea
  // que justo en las carteras grandes no vigilaría. Aquí cuesta una línea y siempre corre.
  if (new Set(filas.map((f) => f.ticker)).size !== filas.length) {
    throw new Error("agregarPorTicker devolvió tickers repetidos: la agregación está rota");
  }
  return filas;
}

const salida = [];
for (const [etiqueta, cik] of GESTORES.slice(0, CUANTOS)) {
  const { nombre, lista, avisoPosterior } = await presentaciones(cik);
  if (!lista.length) { console.log(`  ⚠ ${etiqueta}: sin 13F-HR`); continue; }

  const trimestres = [];
  for (const p of lista) {
    const { info, error, fichero } = await leer(cik, p);
    if (error) { console.log(`  ⚠ ${etiqueta} ${p.periodo}: ${error}`); continue; }

    // ⚠️ CERO POSICIONES NO ES UNA CARTERA VACÍA: es que no se ha entendido el documento. Le pasó
    // a Bridgewater, que daba 0 teniendo 997, porque declara `<ns1:infoTable>` con espacio de
    // nombres y los otros tres no. Un gestor de 13F SIEMPRE tiene posiciones.
    if (!info.posiciones.length) {
      console.error(`\n  ⛔ ${etiqueta} ${p.periodo}: 0 posiciones en ${fichero}.`);
      console.error(`     Un declarante de 13F siempre tiene posiciones. Esto es un fallo de lectura.\n`);
      process.exit(1);
    }

    // ⚠️ LA UNIDAD DE `value` NO ES LA MISMA EN TODOS. Cinco de los seis gestores medidos
    // declaran en dólares y Duquesne en MILES. Se decide por el precio implícito (valor/cantidad),
    // no por la fecha: hay declarantes tardíos en las dos direcciones.
    const esc = escalaDeValor(info.posiciones);
    const factor = esc?.factor ?? 1;

    const conTicker = [], sinMapear = [];
    for (const a of info.acciones) {
      const t = a.cusip ? cusipATicker[a.cusip] : null;
      const p = { ...a, valor: a.valor == null ? null : a.valor * factor, ticker: t };
      if (t) conTicker.push(p); else sinMapear.push(p);
    }
    const valorAcciones = info.acciones.reduce((s, x) => s + (x.valor ?? 0), 0) * factor;
    const valorMapeado = conTicker.reduce((s, x) => s + (x.valor ?? 0), 0);

    trimestres.push({
      periodo: info.periodo ?? periodoISO(p.periodo),
      presentado: p.presentado,
      enmienda: p.enmienda,
      retrasoDias: retrasoDias(info.periodo ?? p.periodo, p.presentado),
      posiciones: info.posiciones.length,
      acciones: info.acciones.length,
      opcionesYdeuda: info.posiciones.length - info.acciones.length,
      valorAcciones,
      // Se publica la unidad detectada: una cifra corregida sin decir que se corrigió es una
      // cifra que nadie puede auditar.
      unidadDeclarada: factor === 1000 ? "miles de dólares (corregido a dólares)" : "dólares",
      precioImplicitoMediano: esc ? Number(esc.precioMediano.toFixed(4)) : null,
      pctValorMapeado: valorAcciones ? Number((100 * valorMapeado / valorAcciones).toFixed(1)) : 0,
      sinMapear: sinMapear.length,
      // Sólo se guardan las del universo de Scora: es lo único que se puede cruzar con el score.
      enUniverso: agregarPorTicker(conTicker.filter((x) => universo.has(x.ticker))),
    });
  }
  if (!trimestres.length) continue;

  // ── El cambio entre los dos trimestres ────────────────────────────────────────────────
  // ⚠️ SÓLO SE COMPARAN DOS PERIODOS DISTINTOS. Si el segundo no existe o es el mismo, no hay
  // movimientos: dejarlo a `null` y decirlo, en vez de publicar una lista vacía que se lee como
  // «este trimestre no movió nada».
  let movimientos = null;
  if (trimestres.length === 2 && trimestres[0].periodo !== trimestres[1].periodo) {
    const [ahora, antes] = trimestres;
    const mapa = (t) => new Map(t.enUniverso.map((x) => [x.ticker, x]));
    const A = mapa(ahora), B = mapa(antes);
    const cambio = (t) => {
      const a = A.get(t)?.cantidad ?? 0, b = B.get(t)?.cantidad ?? 0;
      return { ticker: t, antes: b, ahora: a, pct: b ? Number((100 * (a - b) / b).toFixed(1)) : null };
    };
    movimientos = {
      compara: `${antes.periodo} → ${ahora.periodo}`,
      abre: [...A.keys()].filter((t) => !B.has(t)).map(cambio),
      cierra: [...B.keys()].filter((t) => !A.has(t)).map(cambio),
      refuerza: [...A.keys()].filter((t) => B.has(t) && (A.get(t).cantidad ?? 0) > (B.get(t).cantidad ?? 0)).map(cambio),
      recorta: [...A.keys()].filter((t) => B.has(t) && (A.get(t).cantidad ?? 0) < (B.get(t).cantidad ?? 0)).map(cambio),
    };
  }

  const t0 = trimestres[0];
  const top = t0.enUniverso.slice(0, 5);
  const conc = t0.valorAcciones ? (100 * top.reduce((s, x) => s + (x.valor ?? 0), 0) / t0.valorAcciones) : 0;
  salida.push({ etiqueta, cik, nombreDeclarado: nombre, trimestres, movimientos, avisoPosterior });

  console.log(`\n  ${etiqueta}  (${nombre ?? "?"})`);
  console.log(`    ${t0.periodo} · presentado ${t0.presentado} · ${t0.retrasoDias} días de retraso${t0.enmienda ? " · ENMIENDA" : ""}`);
  if (avisoPosterior) {
    console.log(`    ⓘ para ${avisoPosterior.periodo} presentó un 13F-NT (AVISO): sus valores los declara otro gestor.`);
    console.log(`      No es un trimestre que falte — es una cartera que no existe por esa vía.`);
  }
  console.log(`    ${t0.posiciones} posiciones (${t0.acciones} acciones, ${t0.opcionesYdeuda} opciones/deuda) · ${(t0.valorAcciones / 1e6).toFixed(0)} M$`);
  console.log(`    mapeadas a ticker: ${t0.pctValorMapeado} % del valor · en el universo de Scora: ${t0.enUniverso.length}`);
  console.log(`    top 5: ${top.map((x) => x.ticker).join(" ")} = ${conc.toFixed(0)} % de la cartera`);
  if (movimientos) {
    const n = (k) => movimientos[k].length;
    console.log(`    ${movimientos.compara}: abre ${n("abre")} · cierra ${n("cierra")} · refuerza ${n("refuerza")} · recorta ${n("recorta")}`);
  } else {
    console.log(`    movimientos: no se sabe (hace falta un segundo trimestre distinto)`);
  }
}

if (!salida.length) {
  console.error(`\n  ⛔ ningún gestor se pudo leer. No se escribe artefacto.\n`);
  process.exit(1);
}

writeFileSync(join(OUT, "carteras13f.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  fuente: "13F-HR de EDGAR · CUSIP→ticker por research/data/cusip_ticker.json",
  advertencias: [
    "NO es actualidad: el plazo legal son 45 días desde el cierre del trimestre y se agota. Publicar SIEMPRE el periodo.",
    "NO es la cartera completa: el 13F sólo cubre valores 13(f) largos. Sin cortos, bonos, efectivo ni extranjero.",
    "Las opciones están EXCLUIDAS del recuento: una put no es una posición larga.",
    "Se usa la presentación más reciente de cada periodo, para que una enmienda sustituya al original.",
  ],
  gestores: salida,
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/carteras13f.json  (${salida.length} gestores)\n`);
