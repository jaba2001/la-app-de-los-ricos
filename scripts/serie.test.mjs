// ─────────────────────────────────────────────────────────────────────────────
// LA SERIE MENSUAL DEL ALLOCATOR — fase 0 del plan de gestión activa
//
// ⚠️ **ESTE FICHERO EXISTE POR UN INCIDENTE QUE NINGÚN TEST HABRÍA CAZADO.**
//
// El 2026-09-01 el caché de precios de `SPY` se sobrescribió con una serie que empezaba en
// **2018-06** en vez de 2006 (`PX_FROM` vale `"2018-06-01"` por defecto en `prices.mjs`, así que
// cualquier script que refresque un símbolo sin fijarla le recorta la historia). Como el backtest
// se saltaba los meses sin precio en vez de fallar, **los 36 meses de la crisis de 2008 se
// volvieron meses planos**, y el resultado publicado fue:
//
//     SPY  +218 %  maxDD −23,9 %      (lo real: +652 %, −50,7 %)
//     Growth +222 %  Sharpe 0,75      (lo canónico: +637 %, Sharpe 1,00)
//
// Todo era internamente coherente: los agregados cuadraban con la serie, la serie reproducía sus
// propias métricas, y la comprobación de la fase 0 pasaba en verde. Lo único que delataba el
// fallo era saber que **un drawdown de −23,9 % para el S&P 500 en una ventana que incluye 2008 es
// imposible**. Ese conocimiento es el que se fija aquí.
//
//   node --experimental-strip-types --no-warnings scripts/serie.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { riskReport, maxDrawdown, sharpe } from "../lib/riskMetrics.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUTA = join(RAIZ, "research", "out", "growth_series.json");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };

if (!existsSync(RUTA)) {
  console.error(`\n  ⛔ falta ${RUTA}. Genéralo con:  node ... research/growth_metrics.mjs\n`);
  process.exit(1);
}
const s = JSON.parse(readFileSync(RUTA, "utf8"));

// ── Estructura ───────────────────────────────────────────────────────────────────────────
ok(Array.isArray(s.fechas) && s.fechas.length >= 200, `la serie cubre al menos 200 meses (tiene ${s.fechas?.length})`);
ok(s.fechas?.[0] <= "2007-01-01", `arranca en 2007 o antes (arranca en ${s.fechas?.[0]})`);
ok(Array.isArray(s.activos) && s.activos.includes("SPY"), "declara los activos, con SPY entre ellos");
ok(/NETOS de coste/i.test(s.unidades ?? ""), "declara que los retornos son NETOS de coste");

const ESTRATEGIAS = ["growth", "growthNoBtc", "defensive", "bench6040", "spy"];
for (const k of ESTRATEGIAS) {
  const e = s.estrategias?.[k];
  ok(!!e, `existe la estrategia ${k}`);
  if (!e) continue;
  ok(e.rets.length === s.fechas.length, `${k}: un retorno por mes (${e.rets.length} vs ${s.fechas.length})`);
  ok(e.pesos.length === s.fechas.length, `${k}: un vector de pesos por mes`);
  ok(e.rets.every((x) => Number.isFinite(x)), `${k}: todos los retornos son finitos`);
  const maxSuma = Math.max(...e.pesos.map((p) => Object.values(p).reduce((a, b) => a + b, 0)));
  ok(maxSuma <= 1.0001, `${k}: los pesos nunca suman más de 1 (máx ${maxSuma.toFixed(4)}) — no hay apalancamiento`);
}

// ── LA COMPROBACIÓN QUE HABRÍA CAZADO EL INCIDENTE ───────────────────────────────────────
// Un índice de renta variable estadounidense que atraviesa 2008 TIENE que enseñar la crisis.
// No es una tolerancia estadística: es un hecho del mundo. Si el drawdown máximo del SPY sale
// suave, la serie no contiene 2008 —da igual lo coherente que sea consigo misma—.
{
  const spy = s.estrategias.spy.rets;
  const dd = maxDrawdown(spy);
  ok(dd <= -45, `el maxDD del SPY refleja 2008: ${dd.toFixed(1)} % (tiene que ser ≤ −45 %)`);

  // Y el mes peor del SPY tiene que ser el desplome de octubre de 2008, del orden de −16 %.
  const peor = Math.min(...spy);
  ok(peor <= -12, `el peor mes del SPY es un desplome real: ${peor.toFixed(1)} % (≤ −12 %)`);

  // Ningún tramo de 12 meses puede ser exactamente plano: eso es lo que produce una serie
  // truncada rellenada con ceros, y es indistinguible de un mercado en calma salvo por esto.
  let planos = 0;
  for (let i = 0; i + 12 <= spy.length; i++) {
    if (spy.slice(i, i + 12).every((x) => x === 0)) planos++;
  }
  ok(planos === 0, `no hay tramos de 12 meses exactamente a cero (hay ${planos}) — eso sería relleno, no mercado`);
}

// ── La serie reproduce lo que el artefacto de agregados publica ──────────────────────────
{
  const agr = join(RAIZ, "research", "out", "growth_metrics.json");
  if (existsSync(agr)) {
    const a = JSON.parse(readFileSync(agr, "utf8"));
    ok(a.months === s.fechas.length, `los dos artefactos hablan de la misma ventana (${a.months} vs ${s.fechas.length})`);
    for (const k of ESTRATEGIAS) {
      const r = riskReport(s.estrategias[k].rets, s.estrategias.spy.rets);
      for (const campo of ["sharpe", "sortino", "calmar", "maxDrawdown"]) {
        ok(r[campo] === a.report[k][campo], `${k}.${campo}: la serie da ${r[campo]} y el agregado publica ${a.report[k][campo]}`);
      }
    }
  }
}

// ── Coherencia entre estrategias ─────────────────────────────────────────────────────────
{
  const dd = (k) => maxDrawdown(s.estrategias[k].rets);
  ok(dd("growth") > dd("spy"), `el allocator cae menos que el índice (${dd("growth").toFixed(1)} % vs ${dd("spy").toFixed(1)} %)`);
  ok(dd("bench6040") > dd("spy"), `y el 60/40 también (${dd("bench6040").toFixed(1)} %)`);
  ok(sharpe(s.estrategias.growth.rets) > sharpe(s.estrategias.spy.rets), "el Sharpe del allocator supera al del índice");

  // El sleeve de BTC sólo puede aportar desde que se declara invertible: antes, growth y
  // growthNoBtc tienen que ser el MISMO número. Fija la fecha declarada en `DISPONIBLE_DESDE`
  // contra el accidente de que la decida el caché de precios — que fue lo que pasó y cambió el
  // resultado de +637 % a +740 % sin tocar una regla.
  const i2018 = s.fechas.findIndex((d) => d >= "2018-06-01");
  ok(i2018 > 0, "la ventana incluye la fecha de alta del sleeve de BTC");
  const g = s.estrategias.growth.rets.slice(0, i2018);
  const n = s.estrategias.growthNoBtc.rets.slice(0, i2018);
  const distintos = g.filter((x, i) => Math.abs(x - n[i]) > 1e-9).length;
  ok(distintos === 0, `antes de 2018-06 el sleeve de BTC no aporta nada (${distintos} meses difieren)`);
}

console.log(pass && !fail ? `\n✓ serie: ${pass} passed, 0 failed\n` : `\n✖ serie: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
