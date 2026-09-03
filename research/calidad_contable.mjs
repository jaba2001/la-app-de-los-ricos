// ─────────────────────────────────────────────────────────────────────────────
// CALIDAD CONTABLE — la vida útil implícita y el precio de recompra, sobre el universo real
//
// Aplica `lib/vidaUtil.ts` y `lib/recompras.ts` a los datos de EDGAR y produce el artefacto.
//
// ⚠️ DOS LISTONES DE CORDURA, y los dos existen porque la métrica correspondiente puede salir
// bonita y estar mal:
//
//   · Si más de un tercio del universo sale con la vida útil «alargada», el umbral está
//     describiendo el auge de capex en vez de señalar excepciones.
//   · Si más de la mitad de los precios de recompra caen FUERA del rango en que la acción
//     cotizó, el recuento de acciones no mide lo que creemos y no se publica ninguno.
//
//   node --experimental-strip-types --no-warnings research/calidad_contable.mjs --n 60
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik } from "./edgar.mjs";
import { loadSP500Historical, membersAsOf, snapshotDate } from "./universe.mjs";
import { vidaUtil, señalesVida, UMBRALES_VIDA } from "../lib/vidaUtil.ts";
import { recompra, lecturaRecompra, UMBRALES_RECOMPRA } from "../lib/recompras.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const UA = { "User-Agent": "Scora research alealvarado804@gmail.com" };
const iN = process.argv.indexOf("--n");
const N = iN >= 0 ? Number(process.argv[iN + 1]) : 60;
if (!Number.isInteger(N) || N < 1) { console.error("\n  ⛔ --n tiene que ser un entero >= 1\n"); process.exit(2); }

// ⚠️ EL ORDEN IMPORTA Y NO ES EL OBVIO. `DepreciationDepletionAndAmortization` incluye la
// AMORTIZACIÓN DE INTANGIBLES, que en una empresa que compra otras no tiene nada que ver con la
// vida útil de sus fábricas. Medido en Amgen 2025: D&A total 5,17 B$, de los que la
// depreciación son 0,76 B$ y la amortización de intangibles 4,30 — el 83 % es lo que NO
// queremos. Con el total salían 2,92 años de vida útil para una farmacéutica con plantas; con
// la depreciación sola, ~20. Por eso se prueba primero `Depreciation` a secas.
const DEP_SOLA = ["Depreciation"];
const DEP_MIXTA = ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"];
const AMORT = ["AmortizationOfIntangibleAssets", "AmortizationOfIntangibleAssetsExcludingFinancingCosts"];
const ACC = ["TreasuryStockSharesAcquired", "StockRepurchasedDuringPeriodShares", "StockRepurchasedAndRetiredDuringPeriodShares"];

/**
 * Elige el tag con el hecho MÁS RECIENTE, no el primero de la lista que tenga datos.
 *
 * ⚠️ Esto no es una preferencia de estilo. Amazon publica DOS tags de capex y el histórico
 * (`PaymentsToAcquirePropertyPlantAndEquipment`) murió en 2016 pero sigue respondiendo. Con la
 * regla «el primero que tenga datos gana» el capex de Amazon salía 5 B$ en vez de 132 B$, y
 * casi publico que un vídeo exageraba cuando el que se equivocaba era yo.
 */
function elegir(gaap, tags, { flujo, unidad = "USD" }) {
  let mejor = [], ultima = "";
  for (const t of tags) {
    const u = gaap?.[t]?.units?.[unidad];
    if (!u) continue;
    const a = u.filter((x) => x.form === "10-K" &&
      (flujo ? (x.start && (new Date(x.end) - new Date(x.start)) > 300 * 86400000) : !x.start));
    if (!a.length) continue;
    const f = a.map((x) => x.end).sort().at(-1);
    if (f > ultima) { ultima = f; mejor = a; }
  }
  return mejor;
}
const delAno = (arr, y) => arr.filter((x) => x.end.slice(0, 4) === String(y)).at(-1) ?? null;

// Rango de cotización del periodo, para el control de cordura del precio de recompra.
const rango = (ticker, desde, hasta) => {
  for (const p of [join(AQUI, ".cache", "px", ticker + ".json"), join(AQUI, ".cache", "px_long", ticker + ".json")]) {
    if (!existsSync(p)) continue;
    try {
      const s = JSON.parse(readFileSync(p, "utf8")).filter((o) => o.date >= desde && o.date <= hasta);
      if (s.length < 20) continue;
      const v = s.map((o) => o.raw ?? o.adj).filter(Number.isFinite);
      if (v.length < 20) continue;
      return { min: Math.min(...v), max: Math.max(...v), ultimo: v[v.length - 1], n: v.length };
    } catch { /* siguiente */ }
  }
  return null;
};

const tabla = await loadSP500Historical();
const universo = [...membersAsOf(tabla, snapshotDate(tabla))].sort().slice(0, N);
console.log(`\n  CALIDAD CONTABLE · ${universo.length} nombres\n`);

const filas = [];
for (const t of universo) {
  try {
    const cik = await tickerToCik(t);
    if (!cik) { filas.push({ ticker: t, estado: "sin CIK" }); continue; }
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, { headers: UA });
    if (!r.ok) { filas.push({ ticker: t, estado: `HTTP ${r.status}` }); continue; }
    const g = (await r.json()).facts?.["us-gaap"] ?? {};

    // Tres vias, en orden de limpieza: la depreciacion sola › el total MENOS la amortizacion
    // de intangibles › el total en crudo, y en ese ultimo caso se marca como contaminado.
    let dep = elegir(g, DEP_SOLA, { flujo: true }), viaDep = "depreciacion_sola";
    if (!dep.length) {
      const mix = elegir(g, DEP_MIXTA, { flujo: true });
      const am = elegir(g, AMORT, { flujo: true });
      if (mix.length && am.length) {
        const porAno = new Map(am.map((x) => [x.end.slice(0, 4), x.val]));
        const limpio = mix.map((x) => { const a = porAno.get(x.end.slice(0, 4)); return a == null ? null : { ...x, val: x.val - a }; })
          .filter((x) => x && x.val > 0);
        if (limpio.length) { dep = limpio; viaDep = "total_menos_amortizacion"; }
      }
      if (!dep.length) { dep = mix; viaDep = mix.length ? "total_contaminado" : "sin_dato"; }
    }
    const bru = elegir(g, ["PropertyPlantAndEquipmentGross"], { flujo: false });
    const imp = elegir(g, ["PaymentsForRepurchaseOfCommonStock"], { flujo: true });
    const acc = elegir(g, ACC, { flujo: true, unidad: "shares" });

    // El ejercicio más reciente con depreciación anual.
    const ano = dep.length ? Number(dep.at(-1).end.slice(0, 4)) : null;
    let v = null, sv = [];
    if (ano) {
      const d1 = delAno(dep, ano), b1 = delAno(bru, ano), b0 = delAno(bru, ano - 1);
      const d0 = delAno(dep, ano - 1), b00 = delAno(bru, ano - 2);
      v = vidaUtil({
        ticker: t, depreciacion: d1?.val ?? null, brutoFin: b1?.val ?? null, brutoIni: b0?.val ?? null,
        prev: d0 && b0 && b00 ? { depreciacion: d0.val, brutoFin: b0.val, brutoIni: b00.val } : null,
      });
      sv = señalesVida(v);
    }

    // ⚠️ LA RECOMPRA TIENE SU PROPIO AÑO. La primera versión la anclaba al ejercicio de la
    // DEPRECIACIÓN, que no tiene nada que ver: una empresa sin depreciación anual etiquetada
    // perdía también su precio de recompra, y la cobertura caía del 58 % al 28 % sin que nada
    // fallara. Dos medidas independientes no pueden compartir ancla.
    let rc = null, lr = null;
    const anoRec = acc.length ? Number(acc.at(-1).end.slice(0, 4)) : null;
    const i1 = anoRec ? delAno(imp, anoRec) : null, a1 = anoRec ? delAno(acc, anoRec) : null;
    if (i1 && a1) {
      const rg = rango(t, i1.start, i1.end);
      // ⚠️ EL PRECIO ACTUAL ES EL DE HOY, NO EL DEL FINAL DEL PERIODO. La primera version pasaba
      // el ultimo precio DEL PERIODO DE RECOMPRA, asi que para una empresa cuyo ultimo hecho
      // etiquetado es de hace años —AbbVie— el «retorno desde la recompra» se medía hasta 2019
      // y salia comparado contra un maximo de 98 cuando la accion cotiza por encima de 240.
      const hoy = rango(t, "1900-01-01", "2999-12-31");
      rc = recompra({
        ticker: t, importe: Math.abs(i1.val), acciones: Math.abs(a1.val),
        precioActual: hoy?.ultimo ?? null, precioMin: rg?.min ?? null, precioMax: rg?.max ?? null,
        antiguedadAnos: (Date.now() - new Date(i1.end).getTime()) / (365.25 * 86400000),
      });
      lr = lecturaRecompra(rc, hoy?.ultimo ?? null);
    }

    filas.push({
      ticker: t, estado: "ok", ano, anoRecompra: anoRec, viaDep,
      vida: v ? {
        ingenua: v.vidaIngenua == null ? null : +v.vidaIngenua.toFixed(2),
        corregida: v.vidaCorregida == null ? null : +v.vidaCorregida.toFixed(2),
        sesgo: v.sesgoCrecimiento == null ? null : +v.sesgoCrecimiento.toFixed(2),
        previa: v.vidaPrevia == null ? null : +v.vidaPrevia.toFixed(2),
        cambioPct: v.cambioRelativo == null ? null : +(v.cambioRelativo * 100).toFixed(1),
        crecimientoPct: v.crecimientoActivo == null ? null : +(v.crecimientoActivo * 100).toFixed(1),
        ruidoso: v.ruidoso, fuera: v.fuera,
      } : null,
      señalesVida: sv,
      recompra: rc ? {
        precioMedio: rc.precioMedio == null ? null : +rc.precioMedio.toFixed(2),
        retornoPct: rc.retornoDesdeRecompra == null ? null : +(rc.retornoDesdeRecompra * 100).toFixed(1),
        creible: rc.creible, motivo: rc.motivo,
      } : null,
      lectura: lr ? { clave: lr.clave } : null,
    });
    await new Promise((x) => setTimeout(x, 120));
  } catch (e) { filas.push({ ticker: t, estado: "error", motivo: e.message }); }
}

const ok = filas.filter((x) => x.estado === "ok");
const conVida = ok.filter((x) => x.vida?.corregida != null);
const conRec = ok.filter((x) => x.recompra?.precioMedio != null);
const recCreible = conRec.filter((x) => x.recompra.creible === true);
const recFalsa = conRec.filter((x) => x.recompra.creible === false);
const alargadas = ok.filter((x) => x.señalesVida?.some((s) => s.clave === "vida_util_alargada"));
const acortadas = ok.filter((x) => x.señalesVida?.some((s) => s.clave === "vida_util_acortada"));

const pc = (n, d = ok.length) => `${String(n).padStart(3)}/${d}  ${d ? ((100 * n) / d).toFixed(0) : 0} %`;
console.log(`  leidos                        ${pc(ok.length, filas.length)}`);
console.log(`  con vida util corregida       ${pc(conVida.length)}`);
console.log(`    la ALARGAN                  ${pc(alargadas.length)}`);
console.log(`    la ACORTAN                  ${pc(acortadas.length)}`);
console.log(`  con precio de recompra        ${pc(conRec.length)}`);
console.log(`    creible (dentro del rango)  ${pc(recCreible.length, conRec.length || 1)}`);
console.log(`    IMPOSIBLE (fuera del rango) ${pc(recFalsa.length, conRec.length || 1)}   <- retenciones por impuestos`);

// El sesgo del crecimiento, que es el hallazgo metodológico: cuánto exagera la fórmula ingenua.
const sesgos = conVida.map((x) => x.vida.sesgo).filter((x) => x != null).sort((a, b) => a - b);
if (sesgos.length) {
  const med = sesgos[Math.floor(sesgos.length / 2)];
  console.log(`\n  EL SESGO DE LA FORMULA INGENUA (años que exagera): mediana ${med.toFixed(2)} · max ${sesgos.at(-1).toFixed(2)}`);
  const peor = conVida.filter((x) => x.vida.sesgo > 2).sort((a, b) => b.vida.sesgo - a.vida.sesgo).slice(0, 6);
  if (peor.length) console.log(`  donde mas: ${peor.map((x) => `${x.ticker} +${x.vida.sesgo.toFixed(1)}a`).join(" · ")}`);
}

const barato = ok.filter((x) => x.lectura?.clave === "recompro_barato");
const caro = ok.filter((x) => x.lectura?.clave === "recompro_caro");
console.log(`\n  RECOMPRAS: ${barato.length} compraron por debajo del precio de hoy · ${caro.length} por encima`);
if (caro.length) console.log(`  recompraron CARO: ${caro.slice(0, 8).map((x) => x.ticker).join(" ")}`);

// ── LOS DOS LISTONES DE CORDURA ─────────────────────────────────────────────────────────
let malo = 0;
if (conVida.length && alargadas.length / conVida.length > 0.35) {
  console.error(`\n  ⚠️ ${((100 * alargadas.length) / conVida.length).toFixed(0)} % con la vida alargada. Eso no es deteccion: es el auge de capex.`);
  console.error(`     Revisa UMBRALES_VIDA antes de publicar esto.`); malo++;
}
if (conRec.length && recFalsa.length / conRec.length > 0.5) {
  console.error(`\n  ⚠️ ${((100 * recFalsa.length) / conRec.length).toFixed(0)} % de los precios de recompra son imposibles.`);
  console.error(`     El recuento de acciones no mide lo que creemos: no se publica ninguno.`); malo++;
}
if (malo) process.exitCode = 1;

writeFileSync(join(AQUI, "out", "calidad_contable.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), umbralesVida: UMBRALES_VIDA, umbralesRecompra: UMBRALES_RECOMPRA,
  resumen: {
    leidos: ok.length, deCuantos: filas.length, conVida: conVida.length,
    alargan: alargadas.length, acortan: acortadas.length,
    conRecompra: conRec.length, recompraCreible: recCreible.length, recompraImposible: recFalsa.length,
    compraronBarato: barato.length, compraronCaro: caro.length,
    sesgoMedianoAnos: sesgos.length ? +sesgos[Math.floor(sesgos.length / 2)].toFixed(2) : null,
  },
  filas,
}, null, 2) + "\n", "utf8");

// ⚠️ LA VERSION LIGERA PARA LA WEB SE GENERA AQUI, no en un script aparte, para que no pueda
// derivar del artefacto que la sostiene. El completo son ~300 KB y no se manda al navegador;
// este lleva solo lo que el panel pinta, y el `asOf` para que la pantalla pueda decir de cuando
// es. Mismo patron que `lib/trackRecord.ts`: una foto versionada, no un dato vivo.
//
// Se publica SOLO lo publicable: vidas fuera de banda y precios de recompra no creibles no
// entran, para que la pantalla no pueda enseñar algo que el modulo ya declaro que no vale.
{
  const slim = {};
  for (const f of ok) {
    // ⚠️ LAS CONTAMINADAS NO SALEN A LA WEB, y esto se decidió DIAGNOSTICANDO, no en teoría.
    // 21 empresas no separan la depreciación de la amortización de intangibles en sus cuentas, y
    // el artefacto las marcaba `total_contaminado` y las publicaba igual con un aviso. Al mirarlas
    // una a una: **BlackRock salía a 2,49 años** —una gestora de activos, cuyo D&A es casi todo
    // amortización de adquisiciones— y **Netflix a 8,42**, que es amortización de CONTENIDO. Eso
    // no es «la vida útil de su inmovilizado»: es otra cosa con el mismo nombre.
    //
    // Un aviso al pie no arregla una cifra que mide otra cosa. En el artefacto se quedan, marcadas,
    // porque son el material del diagnóstico; a la pantalla no llegan.
    const tieneVida = f.vida?.corregida != null && !f.vida.fuera && f.viaDep !== "total_contaminado";
    const tieneRec = f.recompra?.precioMedio != null && f.recompra.creible !== false;
    if (!tieneVida && !tieneRec) continue;
    slim[f.ticker] = {
      ...(tieneVida ? {
        vidaCorregida: f.vida.corregida, vidaIngenua: f.vida.ingenua, vidaPrevia: f.vida.previa,
        crecimientoPct: f.vida.crecimientoPct, ruidoso: f.vida.ruidoso, viaDep: f.viaDep,
        senales: (f.señalesVida ?? []).map((s) => ({ clave: s.clave, texto: s.texto, evidencia: s.evidencia })),
      } : {}),
      ...(tieneRec ? {
        precioRecompra: f.recompra.precioMedio, retornoRecompraPct: f.recompra.retornoPct,
        recompraCreible: f.recompra.creible, anoRecompra: f.anoRecompra,
      } : {}),
    };
  }
  const ts = [
    "// GENERADO por research/calidad_contable.mjs — NO editar a mano.",
    "//",
    "// Foto precalculada de la vida util implicita y el precio de recompra. Existe porque la web",
    "// habla con FMP y FMP NO expone lo que estas dos medidas necesitan: no da el inmovilizado",
    "// BRUTO (solo el neto), no separa la depreciacion de la amortizacion de intangibles, y no",
    "// publica las ACCIONES recompradas. Todo eso sale de EDGAR, y el endpoint del proxy tampoco",
    "// lo sirve. Se comprobo ANTES de construir el panel, no despues.",
    "//",
    "// ⚠️ ES UNA FOTO, NO UN DATO VIVO. La pantalla dice de cuando es.",
    "",
    "export interface SenalCalidad { clave: string; texto: string; evidencia: Record<string, number> }",
    "export interface FilaCalidad {",
    "  vidaCorregida?: number; vidaIngenua?: number; vidaPrevia?: number | null;",
    "  crecimientoPct?: number | null; ruidoso?: boolean; viaDep?: string; senales?: SenalCalidad[];",
    "  precioRecompra?: number; retornoRecompraPct?: number | null;",
    "  recompraCreible?: boolean | null; anoRecompra?: number | null;",
    "}",
    "",
    `export const CALIDAD_ASOF = ${JSON.stringify(new Date().toISOString().slice(0, 10))};`,
    `export const CALIDAD_UNIVERSO = ${ok.length};`,
    `export const CALIDAD_CONTABLE: Record<string, FilaCalidad> = ${JSON.stringify(slim)};`,
    "",
  ].join("\n");
  writeFileSync(join(AQUI, "..", "lib", "calidadContableDatos.ts"), ts, "utf8");
  console.log(`  → lib/calidadContableDatos.ts  (${Object.keys(slim).length} nombres, ${Math.round(ts.length / 1024)} KB)`);
}
console.log(`\n  → research/out/calidad_contable.json\n`);
