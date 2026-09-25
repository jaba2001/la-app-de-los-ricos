// Guard de lib/server/dailyClose.js — el informe de cierre.
//   node scripts/dailyclose.test.mjs
//
// POR QUÉ EXISTE: este informe se publica con la marca Scora y sin nadie revisándolo. Los
// fallos que importan no son de formato, son de VERACIDAD: llamar "contenida" a una
// volatilidad de 35, decir "rotación" en un día en que todo se movió junto, o rellenar con
// texto un hueco donde falta el dato. Todo eso es puro y se prueba aquí entero.
import {
  buildDailyClose, classifyBreadth, rankSectorDay, regimeShift, SECTOR_UNIVERSE, parseYahooQuote,
} from "../lib/server/dailyClose.js";

let bad = 0, n = 0;
function check(label, got, want) {
  n++;
  if (got !== want) { bad++; console.log(`FAIL  ${label}\n      got:  ${got}\n      want: ${want}`); }
}
function ok(label, cond) { n++; if (!cond) { bad++; console.log(`FAIL  ${label}`); } }

const sec = (vals) => SECTOR_UNIVERSE.map((s, i) => ({ ...s, changePct: vals[i] }));

// ── classifyBreadth: el corazón del informe ─────────────────────────────────────
// Día "beta": todos abajo, casi sin dispersión.
{
  const b = classifyBreadth(sec([-1.0, -1.1, -0.9, -1.0, -1.05, -0.95, -1.0, -1.1, -0.9, -1.0, -1.0]));
  check('día beta: 0 sectores arriba', b.up, 0);
  check('día beta: clasificado como beta', b.kind, "beta");
  ok('día beta: dispersión baja', b.dispersion < 0.5);
  check('día beta: acuerdo total', b.agreement, 1);
}
// Día de rotación: partido y muy disperso.
{
  const b = classifyBreadth(sec([3.2, 2.8, 1.9, -2.4, -3.1, 4.0, -1.8, -2.9, 0.4, -3.4, 2.2]));
  check('día de rotación: clasificado como rotation', b.kind, "rotation");
  ok('día de rotación: dispersión alta', b.dispersion >= 1.0);
  ok('día de rotación: reparto equilibrado', b.agreement < 0.9);
  check('día de rotación: cuenta arriba+abajo = total', b.up + b.down, b.total);
}
// Día amplio: casi todos del mismo lado pero con dispersión apreciable.
{
  const b = classifyBreadth(sec([2.4, 1.9, 1.5, 1.2, 0.9, 0.8, 0.7, 0.6, 0.4, 0.2, -0.3]));
  check('día amplio: clasificado como broad', b.kind, "broad");
  check('día amplio: 10 arriba', b.up, 10);
}
// Degradación: sin datos suficientes no se inventa una lectura.
check('breadth con 2 sectores → null', classifyBreadth([{ etf: "XLK", changePct: 1 }, { etf: "XLF", changePct: 2 }]), null);
check('breadth con lista vacía → null', classifyBreadth([]), null);
check('breadth con null → null', classifyBreadth(null), null);
ok('breadth ignora sectores sin dato', classifyBreadth(sec([1, 2, 3, null, null, null, null, null, null, null, null])) !== null);

// ── rankSectorDay ───────────────────────────────────────────────────────────────
{
  const r = rankSectorDay(sec([3.2, 2.8, 1.9, -2.4, -3.1, 4.0, -1.8, -2.9, 0.4, -3.4, 2.2]));
  check('ranking: el primero es el mejor', r.rows[0].changePct, 4.0);
  check('ranking: el último es el peor', r.rows[r.rows.length - 1].changePct, -3.4);
  check('ranking: 3 líderes', r.leaders.length, 3);
  check('ranking: 3 rezagados', r.laggards.length, 3);
  check('ranking: el primer rezagado es el peor de todos', r.laggards[0].changePct, -3.4);
  ok('ranking: líderes ordenados descendente', r.leaders[0].changePct >= r.leaders[1].changePct);
  ok('ranking: rezagados ordenados ascendente en calidad', r.laggards[0].changePct <= r.laggards[1].changePct);
}
check('ranking descarta filas sin cambio', rankSectorDay([{ etf: "XLK", changePct: null }, { etf: "XLF", changePct: 1 }]).rows.length, 1);
check('ranking con null → vacío', rankSectorDay(null).rows.length, 0);

// ── regimeShift ─────────────────────────────────────────────────────────────────
check('cambio de régimen detectado', regimeShift({ regime_id: "contraction" }, { regime_id: "expansion" }).changed, true);
check('mismo régimen no es cambio', regimeShift({ regime_id: "expansion" }, { regime_id: "expansion" }).changed, false);
check('sin snapshot previo no es cambio', regimeShift({ regime_id: "expansion" }, null).changed, false);
check('mayúsculas se normalizan', regimeShift({ regime_id: "EXPANSION" }, { regime_id: "expansion" }).changed, false);
check('confirmación leída', regimeShift({ regime_id: "expansion", regime_confirmation: "confirmed" }, null).confirmed, true);
check('sin confirmación', regimeShift({ regime_id: "expansion" }, null).confirmed, false);

// ── buildDailyClose: el informe completo ────────────────────────────────────────
const macro = { regime_id: "expansion", regime_confirmation: "confirmed", vix: 14.2, hy_oas: 312, dgs10: 4.23, risk_on: 61 };

// Día normal, todo presente.
{
  const rep = buildDailyClose({
    macro, prevMacro: { regime_id: "expansion" },
    spy: { changePct: -1.02 },
    sectors: sec([-1.0, -1.1, -0.9, -1.0, -1.05, -0.95, -1.0, -1.1, -0.9, -1.0, -1.0]),
    date: "2026-08-18",
  });
  check('informe: fecha', rep.date, "2026-08-18");
  ok('informe: titular no vacío', rep.headline.length > 40);
  ok('informe: incluye el cierre del índice', rep.headline.includes("−1.02%"));
  ok('informe: día beta se explica como bloque', rep.headline.includes("as one block"));
  ok('informe: dice que la selección tuvo poco margen', rep.headline.includes("Selection had little"));
  ok('informe: régimen sin cambio se reporta igual', rep.headline.includes("still reads expansion"));
  ok('informe: contexto con VIX', rep.context.includes("14.2"));
  check('informe: 11 sectores', rep.sectors.length, 11);
  check('informe: sin huecos', rep.gaps.length, 0);
  ok('informe: serializable a JSON', typeof JSON.stringify(rep) === "string");
}

// El adjetivo del VIX SIGUE al número — el fallo de veracidad más fácil de cometer.
{
  const calm = buildDailyClose({ macro: { ...macro, vix: 12 }, prevMacro: null, spy: { changePct: 0.4 }, sectors: sec([0.4, 0.3, 0.5, 0.4, 0.4, 0.3, 0.4, 0.5, 0.3, 0.4, 0.4]), date: "d" });
  const panic = buildDailyClose({ macro: { ...macro, vix: 38 }, prevMacro: null, spy: { changePct: -4 }, sectors: sec([-4, -4.1, -3.9, -4, -4.05, -3.95, -4, -4.1, -3.9, -4, -4]), date: "d" });
  ok('VIX 12 se describe como subdued', calm.context.includes("subdued"));
  ok('VIX 38 NO se describe como subdued', !panic.context.includes("subdued"));
  ok('VIX 38 se describe como stressed', panic.context.includes("stressed"));
  const mid = buildDailyClose({ macro: { ...macro, vix: 25 }, prevMacro: null, spy: { changePct: -1 }, sectors: sec([-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]), date: "d" });
  ok('VIX 25 se describe como elevated', mid.context.includes("elevated"));
}

// Cambio de régimen: es la noticia del día y tiene que salir.
{
  const rep = buildDailyClose({
    macro: { ...macro, regime_id: "contraction" }, prevMacro: { regime_id: "expansion" },
    spy: { changePct: -2.1 }, sectors: sec([-2, -2.1, -1.9, -2, -2, -2, -2, -2.1, -1.9, -2, -2]), date: "d",
  });
  check('cambio de régimen marcado', rep.regime.changed, true);
  ok('cambio de régimen narrado', rep.headline.includes("from expansion to contraction"));
}

// Rotación: la lectura que ningún "recap" da.
{
  const rep = buildDailyClose({
    macro, prevMacro: { regime_id: "expansion" }, spy: { changePct: 0.05 },
    sectors: sec([3.2, 2.8, 1.9, -2.4, -3.1, 4.0, -1.8, -2.9, 0.4, -3.4, 2.2]), date: "d",
  });
  ok('rotación narrada como tal', rep.headline.includes("rotation, not direction"));
  check('rotación: clasificación coherente', rep.breadth.kind, "rotation");
}

// Degradación honesta: los huecos se DECLARAN, no se rellenan.
{
  const noMacro = buildDailyClose({ macro: null, prevMacro: null, spy: { changePct: 1 }, sectors: sec([1,1,1,1,1,1,1,1,1,1,1]), date: "d" });
  ok('sin macro se declara el hueco', noMacro.gaps.includes("no macro snapshot"));
  check('sin macro no se inventa régimen', noMacro.regime.id, null);
  check('sin macro el contexto queda vacío', noMacro.context, "");

  const noQuote = buildDailyClose({ macro, prevMacro: null, spy: null, sectors: sec([1,1,1,1,1,1,1,1,1,1,1]), date: "d" });
  ok('sin cotización se declara el hueco', noQuote.gaps.includes("no index quote"));
  check('sin cotización no se inventa un número', noQuote.market.spyChangePct, null);
  ok('sin cotización el titular no empieza por el índice', !noQuote.headline.startsWith("The S&P 500"));

  const noSectors = buildDailyClose({ macro, prevMacro: null, spy: { changePct: 1 }, sectors: [], date: "d" });
  ok('sin sectores se declara el hueco', noSectors.gaps.includes("not enough sector quotes"));
  check('sin sectores no hay breadth', noSectors.breadth, null);

  const nothing = buildDailyClose({ macro: null, prevMacro: null, spy: null, sectors: [], date: "d" });
  check('sin nada: tres huecos declarados', nothing.gaps.length, 3);
  ok('sin nada: no revienta', typeof nothing.headline === "string");
  ok('sin nada: sigue siendo serializable', typeof JSON.stringify(nothing) === "string");
}

// El universo es el esperado y no tiene duplicados.
check('universo de 11 sectores', SECTOR_UNIVERSE.length, 11);
check('universo sin duplicados', new Set(SECTOR_UNIVERSE.map((s) => s.etf)).size, 11);
ok('universo con nombre legible en todos', SECTOR_UNIVERSE.every((s) => s.name && s.name.length > 2));

// Invariante: nunca lanza, con cualquier basura.
for (const m of [null, {}, { regime_id: 123 }, { vix: "x" }]) {
  for (const s of [null, [], sec([1,2,3,4,5,6,7,8,9,10,11]), [{ etf: null }]]) {
    try {
      const rep = buildDailyClose({ macro: m, prevMacro: null, spy: null, sectors: s, date: "d" });
      ok('buildDailyClose devuelve titular string', typeof rep.headline === "string");
    } catch (e) { bad++; n++; console.log(`FAIL  buildDailyClose lanzó: ${e.message}`); }
  }
}


// ── Contrato con la UI ──────────────────────────────────────────────────────────
// app/daily/page.tsx declara una interfaz DailyReport sobre este payload.
// Si el backend deja de emitir un campo, la página se rompe en silencio en producción y
// nadie se entera hasta que alguien la abre. Este test fija el contrato.
{
  const rep = buildDailyClose({
    macro, prevMacro: { regime_id: "contraction" },
    spy: { changePct: -1.02 },
    sectors: sec([3.2, 2.8, 1.9, -2.4, -3.1, 4.0, -1.8, -2.9, 0.4, -3.4, 2.2]),
    date: "2026-08-18",
  });
  for (const k of ["date", "generatedAt", "regime", "market", "breadth", "sectors", "leaders", "laggards", "headline", "context", "gaps"]) {
    ok(`contrato: campo raíz "${k}" presente`, k in rep);
  }
  for (const k of ["id", "previousId", "changed", "confirmed"]) ok(`contrato: regime.${k}`, k in rep.regime);
  for (const k of ["spyChangePct", "vix", "hyOas", "dgs10", "riskOn"]) ok(`contrato: market.${k}`, k in rep.market);
  for (const k of ["up", "down", "total", "dispersion", "agreement", "kind"]) ok(`contrato: breadth.${k}`, k in rep.breadth);
  for (const k of ["etf", "name", "changePct"]) ok(`contrato: sectors[].${k}`, k in rep.sectors[0]);
  // La UI indexa BREADTH_LABEL/BREADTH_NOTE por kind: un valor nuevo saldría "undefined".
  ok("contrato: breadth.kind es uno de los 4 conocidos", ["beta", "rotation", "broad", "mixed"].includes(rep.breadth.kind));
  // La UI hace .toFixed() sobre estos: tienen que ser números, no strings.
  ok("contrato: dispersion es number", typeof rep.breadth.dispersion === "number");
  ok("contrato: agreement es number", typeof rep.breadth.agreement === "number");
  ok("contrato: changePct es number", typeof rep.sectors[0].changePct === "number");
  ok("contrato: headline es string", typeof rep.headline === "string");
  ok("contrato: gaps es array", Array.isArray(rep.gaps));
  // Sobrevive al viaje por jsonb (Supabase) sin perder forma.
  const round = JSON.parse(JSON.stringify(rep));
  ok("contrato: round-trip JSON conserva el payload", JSON.stringify(round) === JSON.stringify(rep));
  ok("contrato: round-trip conserva los 11 sectores", round.sectors.length === 11);
}

// ── parseYahooQuote: la fuente de precios del cierre ────────────────────────────
// POR QUÉ IMPORTA: se descubrió probando contra la API REAL que el plan de FMP de este
// proyecto no cubre ETFs (HTTP 402 en XLK/XLF/GLD/QQQ, y la forma batch siempre). El cron
// habría respondido 503 sin escribir fila y /daily habría estado vacío para siempre, con
// el build y todos los tests en verde. Estas comprobaciones fijan el parseo del sustituto.
{
  const meta = (o) => ({ chart: { result: [{ meta: { regularMarketPrice: 100, chartPreviousClose: 100, regularMarketTime: 1787083200, ...o } }] } });

  // Cálculo del cambio diario.
  {
    const q = parseYahooQuote(meta({ regularMarketPrice: 110, chartPreviousClose: 100 }));
    check('yahoo: +10%', Math.round(q.pct * 1000) / 1000, 10);
  }
  {
    const q = parseYahooQuote(meta({ regularMarketPrice: 95, chartPreviousClose: 100 }));
    check('yahoo: -5%', Math.round(q.pct * 1000) / 1000, -5);
  }
  {
    const q = parseYahooQuote(meta({ regularMarketPrice: 100, chartPreviousClose: 100 }));
    check('yahoo: sin cambio = 0', q.pct, 0);
  }
  // Caso real medido el 18-08-2026 (XLK): 185.62 sobre 186.09.
  {
    const q = parseYahooQuote(meta({ regularMarketPrice: 185.62, chartPreviousClose: 186.09 }));
    ok('yahoo: caso real XLK ≈ -0.25%', Math.abs(q.pct - (-0.2526)) < 0.001);
  }

  // `previousClose` sirve de reserva cuando falta `chartPreviousClose`.
  {
    const j = { chart: { result: [{ meta: { regularMarketPrice: 110, previousClose: 100 } }] } };
    const q = parseYahooQuote(j);
    ok('yahoo: usa previousClose como reserva', q !== null && Math.round(q.pct) === 10);
  }

  // Fecha del dato: permite fechar el informe por la sesión real, no por el reloj del cron.
  {
    const q = parseYahooQuote(meta({ regularMarketTime: 1787083200 }));
    ok('yahoo: asOf es un día ISO', /^\d{4}-\d{2}-\d{2}$/.test(q.asOf));
  }
  {
    const q = parseYahooQuote(meta({ regularMarketTime: null }));
    check('yahoo: sin marca de tiempo, asOf null', q.asOf, null);
  }

  // Degradación: nada de esto puede devolver un número inventado.
  check('yahoo: null', parseYahooQuote(null), null);
  check('yahoo: undefined', parseYahooQuote(undefined), null);
  check('yahoo: objeto vacío', parseYahooQuote({}), null);
  check('yahoo: sin result', parseYahooQuote({ chart: {} }), null);
  check('yahoo: result vacío', parseYahooQuote({ chart: { result: [] } }), null);
  check('yahoo: sin meta', parseYahooQuote({ chart: { result: [{}] } }), null);
  check('yahoo: sin precio', parseYahooQuote(meta({ regularMarketPrice: null })), null);
  check('yahoo: sin cierre previo', parseYahooQuote(meta({ chartPreviousClose: null, previousClose: null })), null);
  // Un cierre previo de 0 daría Infinity: tiene que caer, no colarse en el informe.
  check('yahoo: cierre previo 0 → null', parseYahooQuote(meta({ chartPreviousClose: 0 })), null);
  check('yahoo: precio 0 → null', parseYahooQuote(meta({ regularMarketPrice: 0 })), null);
  check('yahoo: precio negativo → null', parseYahooQuote(meta({ regularMarketPrice: -5 })), null);
  check('yahoo: precio no numérico → null', parseYahooQuote(meta({ regularMarketPrice: "x" })), null);
  check('yahoo: respuesta de error de la API', parseYahooQuote({ chart: { result: null, error: { code: "Not Found" } } }), null);

  // Invariante: nunca lanza, y si devuelve algo es un número finito.
  for (const j of [null, {}, { chart: null }, { chart: { result: [null] } }, meta({}), meta({ regularMarketPrice: NaN }), "texto", 42]) {
    try {
      const q = parseYahooQuote(j);
      ok('yahoo: o null o un pct finito', q === null || Number.isFinite(q.pct));
    } catch (e) { bad++; n++; console.log(`FAIL  parseYahooQuote lanzó: ${e.message}`); }
  }
}
console.log(`\n${bad === 0 ? "✓" : "✗"} dailyClose: ${n - bad} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
