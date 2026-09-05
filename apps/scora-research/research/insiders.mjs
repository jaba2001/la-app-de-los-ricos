// ─────────────────────────────────────────────────────────────────────────────
// MOVIMIENTOS DE DIRECTIVOS (FORM 4)
//
// Fase 3 del roadmap de capacidades. Es el producto entero de Insider Tracker —155 K seguidores,
// 353 K visualizaciones en un tuit— y sale de EDGAR, que Scora ya consulta.
//
// LA VÍA MASIVA, y corrige lo que yo mismo había supuesto. No son 500 peticiones por empresa: el
// índice diario de EDGAR trae TODOS los Form 4 del mercado en un fichero de 1,4 MB (811 el
// 2026-08-28). Se filtra por CIK contra el universo y sólo se descarga lo que interesa.
//
//   https://www.sec.gov/Archives/edgar/daily-index/AAAA/QTRn/form.AAAAMMDD.idx
//
// ⚠️ DOS COSAS DEL ÍNDICE que no son obvias:
//
//   1. **La misma presentación aparece varias veces**, una por cada CIK implicado: el emisor y
//      cada insider que declara. Hay que deduplicar por número de acceso, no por ruta — si no,
//      una operación con tres declarantes se cuenta tres veces.
//   2. **El CIK del emisor es el que sirve para filtrar.** El de un insider es el de una PERSONA
//      y nunca está en un universo de empresas, así que casar contra el universo selecciona
//      justo las filas del emisor.
//
// Y el `.txt` de la presentación completa lleva el XML dentro, así que basta una petición.
//
//   node --experimental-strip-types --no-warnings research/insiders.mjs [--dias 5]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseForm4, esDecisionDeMercado } from "../lib/form4.ts";
import { tickerToCik } from "./edgar.mjs";
import { priceAsOf, returnsSeries } from "./prices.mjs";
import { loadSP500Historical, membersAsOf, snapshotDate } from "./universe.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const UA = { "User-Agent": "scora-research alealvarado804@gmail.com", "Accept-Encoding": "gzip, deflate" };
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DIAS = Number(arg("--dias", "5"));

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const trimestre = (f) => Math.floor(Number(f.slice(5, 7)) / 3.01) + 1;

// ── 1 · El universo, por CIK ─────────────────────────────────────────────────────────────
const tabla = await loadSP500Historical();
const asOf = snapshotDate(tabla);
const universo = membersAsOf(tabla, asOf);

const porCik = new Map();
const sinCik = [];
for (const t of universo) {
  let cik = null;
  try { cik = await tickerToCik(t); } catch { /* se cuenta abajo */ }
  // ⚠️ Un ticker sin CIK NO se da por «no está»: se cuenta y se dice. Sus Form 4 se perderían en
  // silencio, que es la forma de fallo que este repo lleva una semana persiguiendo.
  if (!cik) { sinCik.push(t); continue; }
  // ⚠️ Y un CIK puede tener VARIOS tickers: son las clases dobles (GOOG/GOOGL, §2quater). Con un
  // `Map` de uno a uno, la última clase pisaba a la primera y el recuento parecía decir que
  // faltaban CIK cuando lo que había eran emisores compartidos. Se guarda la lista.
  const k = String(Number(cik));
  if (!porCik.has(k)) porCik.set(k, []);
  porCik.get(k).push(t);
}
const dobles = [...porCik.values()].filter((v) => v.length > 1);
console.log(`\n  MOVIMIENTOS DE DIRECTIVOS · ${universo.length} tickers · ${porCik.size} emisores distintos`);
if (dobles.length) console.log(`  (${dobles.length} emisores con más de una clase: ${dobles.map((v) => v.join("+")).join(" · ")})`);
if (sinCik.length) console.log(`  ⚠ SIN CIK, y sus Form 4 se pierden: ${sinCik.join(" ")}`);
console.log();

// ── 2 · Los índices diarios ──────────────────────────────────────────────────────────────
// Se recorren días naturales hacia atrás; los que no existen (fines de semana, festivos)
// devuelven 404 y se saltan. No se asume el calendario: se pregunta.
const hoy = new Date();
const candidatas = [];
for (let i = 1; i <= DIAS * 2 && candidatas.length < DIAS; i++) {
  const d = new Date(hoy); d.setUTCDate(d.getUTCDate() - i);
  const f = d.toISOString().slice(0, 10);
  const url = `https://www.sec.gov/Archives/edgar/daily-index/${f.slice(0, 4)}/QTR${trimestre(f)}/form.${f.replace(/-/g, "")}.idx`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) { await espera(120); continue; }
  candidatas.push({ fecha: f, texto: await r.text() });
  await espera(120);
}
console.log(`  índices con datos: ${candidatas.map((c) => c.fecha).join(" · ") || "ninguno"}`);

// ── 3 · Las filas que nos tocan ──────────────────────────────────────────────────────────
const porAcceso = new Map();
let totalF4 = 0;
for (const { fecha, texto } of candidatas) {
  for (const linea of texto.split("\n")) {
    if (!/^4\s{2,}/.test(linea)) continue;
    totalF4++;
    const partes = linea.trim().split(/\s{2,}/);
    const ruta = partes.at(-1)?.trim();
    const cik = partes.at(-3)?.trim();
    if (!ruta || !cik) continue;
    const tickers = porCik.get(String(Number(cik)));
    if (!tickers) continue;                      // no es el emisor de nuestro universo
    // Con clases dobles hay varios; el ticker DEFINITIVO lo declara el propio documento
    // (`issuerTradingSymbol`), así que aquí basta con saber que el emisor nos interesa.
    const ticker = tickers[0];
    const acceso = ruta.split("/").pop()?.replace(".txt", "");
    if (!acceso || porAcceso.has(acceso)) continue;   // ⚠️ deduplicar por acceso, no por ruta
    porAcceso.set(acceso, { fecha, ruta, ticker });
  }
}
console.log(`  Form 4 en el mercado: ${totalF4}   ·   de nuestro universo: ${porAcceso.size}\n`);

// ── 4 · Descargar y parsear ──────────────────────────────────────────────────────────────
const operaciones = [];
const fallos = [];
let n = 0;
for (const [acceso, meta] of porAcceso) {
  process.stdout.write(`  ${++n}/${porAcceso.size}\r`);
  let xml = null;
  try {
    const r = await fetch(`https://www.sec.gov/Archives/${meta.ruta}`, { headers: UA });
    if (r.ok) {
      const txt = await r.text();
      const i = txt.indexOf("<ownershipDocument>");
      const j = txt.indexOf("</ownershipDocument>");
      if (i >= 0 && j > i) xml = txt.slice(i, j + "</ownershipDocument>".length);
    }
  } catch { /* se cuenta abajo */ }
  await espera(110);

  if (!xml) { fallos.push({ acceso, ticker: meta.ticker, motivo: "no se pudo leer el documento" }); continue; }
  const doc = parseForm4(xml);
  if (!doc) { fallos.push({ acceso, ticker: meta.ticker, motivo: "el XML no es un Form 4" }); continue; }

  for (const op of doc.operaciones) {
    // El contexto de precio es lo que Scora puede añadir y la competencia no: la operación
    // contra el mercado de ese día y contra el máximo del último año.
    let precioMercado = null, vsMaximo = null;
    if (op.fecha && op.ticker) {
      try {
        precioMercado = await priceAsOf(op.ticker, op.fecha);
        const s = await returnsSeries(op.ticker);
        if (s?.length && op.precio) {
          // Máximo de las ~252 sesiones anteriores a la operación, en precio ajustado.
          const hasta = s.findIndex((x) => x.date > op.fecha);
          const tramo = s.slice(Math.max(0, (hasta < 0 ? s.length : hasta) - 252), hasta < 0 ? s.length : hasta);
          if (tramo.length) {
            const precios = [];
            for (const b of tramo) precios.push(await priceAsOf(op.ticker, b.date));
            const max = Math.max(...precios.filter(Number.isFinite));
            if (Number.isFinite(max) && max > 0 && precioMercado) vsMaximo = (precioMercado / max - 1) * 100;
          }
        }
      } catch { /* el contexto es opcional; la operación no */ }
    }
    operaciones.push({
      ...op,
      acceso, presentado: meta.fecha,
      decisionDeMercado: esDecisionDeMercado(op),
      precioMercado: precioMercado != null ? Number(precioMercado.toFixed(2)) : null,
      vsMaximo52s: vsMaximo != null ? Number(vsMaximo.toFixed(1)) : null,
    });
  }
}
process.stdout.write("                    \r");

// ── 5 · Resumen ──────────────────────────────────────────────────────────────────────────
const decisiones = operaciones.filter((o) => o.decisionDeMercado);
const mecanicas = operaciones.filter((o) => !o.decisionDeMercado);
const conPlan = operaciones.filter((o) => o.plan10b51 === true);
const sinDeclarar = operaciones.filter((o) => o.plan10b51 == null);

console.log(`  operaciones: ${operaciones.length}   ·   fallos: ${fallos.length}`);
console.log(`  DECISIONES de mercado (P/S sin plan): ${decisiones.length}`);
console.log(`  mecánicas (concesión, ejercicio, retención fiscal o plan 10b5-1): ${mecanicas.length}`);
console.log(`     de ellas, con plan 10b5-1 declarado: ${conPlan.length}`);
if (sinDeclarar.length) console.log(`     ⚠ sin declarar si hay plan: ${sinDeclarar.length} (se cuentan aparte, no como «sin plan»)`);

const porCodigo = {};
for (const o of operaciones) porCodigo[o.codigo ?? "?"] = (porCodigo[o.codigo ?? "?"] ?? 0) + 1;
console.log(`  por código: ${Object.entries(porCodigo).sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c}=${k}`).join(" ")}`);

// ⚠️ LA CIFRA QUE MANDA, y la que separa esto de la competencia: sólo el ${(100 * decisiones.length / (operaciones.length || 1)).toFixed(0)} % de la
// actividad Form 4 es una decisión de mercado. Publicar las 459 como «operaciones de directivos»
// —que es lo que se ve por ahí— es contar concesiones, ejercicios y retenciones fiscales como si
// alguien hubiera elegido comprar o vender.
console.log(`\n  ⇒ sólo el ${(100 * decisiones.length / (operaciones.length || 1)).toFixed(0)} % de la actividad Form 4 es una decisión de mercado`);

// Agregado POR EMISOR. Sin esto el «top 10» lo copa un solo comprador con diez presentaciones —
// Cascade Investment hizo diez compras de RSG en tres días— y la tabla deja de informar.
const porEmisor = new Map();
for (const o of decisiones) {
  if (o.valor == null || !o.ticker) continue;
  const signo = o.codigo === "S" ? -1 : 1;
  const e = porEmisor.get(o.ticker) ?? { ticker: o.ticker, neto: 0, operaciones: 0, insiders: new Set() };
  e.neto += signo * o.valor;
  e.operaciones++;
  if (o.insider) e.insiders.add(o.insider);
  porEmisor.set(o.ticker, e);
}
const ranking = [...porEmisor.values()]
  .map((e) => ({ ...e, insiders: [...e.insiders] }))
  .sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto));

if (ranking.length) {
  console.log(`\n  ── Compra y venta NETA de directivos, por empresa ──`);
  for (const e of ranking.slice(0, 10)) {
    const quien = e.insiders.length === 1 ? e.insiders[0] : `${e.insiders.length} insiders`;
    console.log(`    ${e.ticker.padEnd(6)} ${e.neto >= 0 ? "+" : "−"}${Math.abs(e.neto / 1e6).toFixed(1)} M$   ${String(e.operaciones).padStart(2)} op.   ${quien}`);
  }
}

const grandes = decisiones.filter((o) => o.valor != null).sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0)).slice(0, 5);
if (grandes.length) {
  console.log(`\n  ── Las mayores operaciones sueltas ──`);
  for (const o of grandes) {
    const quien = o.cargo ?? (o.esDirectivo ? "directivo" : o.esDirector ? "consejero" : o.esDuenoDel10 ? "10 %" : "insider");
    const ctx = o.vsMaximo52s != null ? `, con la acción a un ${o.vsMaximo52s.toFixed(0)} % de su máximo de 52 semanas` : "";
    console.log(`    ${o.ticker.padEnd(6)} ${o.codigo === "S" ? "vendió" : "compró"} por ${(o.valor / 1e6).toFixed(1)} M$${ctx}`);
    console.log(`           ${o.insider} (${quien}) · ${o.fecha} · presentado el ${o.presentado}`);
  }
}
if (fallos.length) {
  console.log(`\n  ⚠ no se pudieron leer ${fallos.length}: ${fallos.slice(0, 6).map((f) => `${f.ticker}/${f.acceso}`).join(" ")}`);
}

writeFileSync(join(OUT, "insiders.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  universoAsOf: asOf, dias: candidatas.map((c) => c.fecha),
  universoSinCik: sinCik,
  form4EnElMercado: totalF4, form4DelUniverso: porAcceso.size,
  pctDecisionesDeMercado: Number((100 * decisiones.length / (operaciones.length || 1)).toFixed(1)),
  netoPorEmisor: ranking,
  operaciones, fallos,
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/insiders.json\n`);
