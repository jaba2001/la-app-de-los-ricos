// Guard de lib/server/alertKinds.js — los kinds que se resuelven contra sl_analyses.
//   node scripts/alertkinds.test.mjs
//
// POR QUÉ EXISTE: estas dos alertas mandan push a usuarios reales. Los dos fallos que
// importan son (a) NO disparar cuando debía —la promesa rota que veníamos arrastrando— y
// (b) disparar en bucle o sobre un análisis muerto, que es peor que el silencio. Ambas
// ramas son puras, así que se prueban aquí enteras sin tocar Supabase.
import {
  ratingCode, ratingBuyTriggered, rdcfUpside, rdcfCheapTriggered,
  isFresh, evaluateAnalysisAlert, ANALYSIS_KINDS, BUY_CODE,
} from "../lib/server/alertKinds.js";

let bad = 0, n = 0;
function check(label, got, want) {
  n++;
  if (got !== want) { bad++; console.log(`FAIL  ${label}\n      got:  ${got}\n      want: ${want}`); }
}

// ── ratingCode: los DOS vocabularios vivos ──────────────────────────────────────
// El que se persiste (getRating):
check('rating "STRONG BUY"', ratingCode("STRONG BUY"), 4);
check('rating "BUY"', ratingCode("BUY"), 3);
check('rating "CAUTION"', ratingCode("CAUTION"), 2);
check('rating "AVOID"', ratingCode("AVOID"), 1);
// El del verdict (ratingFrom) — no se persiste hoy, pero si cambiara el vocabulario las
// alertas no deben apagarse en silencio:
check('rating "Strong Buy"', ratingCode("Strong Buy"), 4);
check('rating "Buy"', ratingCode("Buy"), 3);
check('rating "Sell"', ratingCode("Sell"), 2);
check('rating "Strong Sell"', ratingCode("Strong Sell"), 1);
// Tolerancia de formato.
check('rating con espacios', ratingCode("  strong buy  "), 4);
check('rating "StrongBuy" sin espacio', ratingCode("StrongBuy"), 4);
// Basura → null, nunca una excepción ni un 0 que parezca "vender".
check('rating null', ratingCode(null), null);
check('rating undefined', ratingCode(undefined), null);
check('rating vacío', ratingCode("   "), null);
check('rating numérico', ratingCode(42), null);
check('rating objeto', ratingCode({}), null);
check('rating desconocido', ratingCode("HOLD"), null);
// Fallback: cualquier etiqueta con "buy" cuenta como comprador (igual que la UI).
check('rating desconocido con buy dentro', ratingCode("Weak Buy"), 3);

// ── ratingBuyTriggered: transición, no estado permanente ────────────────────────
check('cruza de CAUTION a BUY dispara', ratingBuyTriggered(2, 3), true);
check('cruza de AVOID a STRONG BUY dispara', ratingBuyTriggered(1, 4), true);
check('sigue en BUY no dispara', ratingBuyTriggered(3, 3), false);
check('BUY -> STRONG BUY no dispara (ya era comprador)', ratingBuyTriggered(3, 4), false);
check('STRONG BUY -> BUY no dispara', ratingBuyTriggered(4, 3), false);
check('cae a CAUTION no dispara', ratingBuyTriggered(3, 2), false);
// Primera lectura: sembrar, no disparar. Sin esto, el primer pase notificaría a todo el
// mundo de golpe por alertas que llevaban meses creadas.
check('primera lectura no dispara', ratingBuyTriggered(null, 4), false);
check('rating actual desconocido no dispara', ratingBuyTriggered(2, null), false);
check('BUY_CODE es 3', BUY_CODE, 3);

// ── rdcfUpside: objeto o texto ──────────────────────────────────────────────────
check('upside desde objeto', rdcfUpside({ upside: 12.5 }), 12.5);
check('upside desde JSON string', rdcfUpside('{"upside": -4.25}'), -4.25);
check('upside cero se conserva', rdcfUpside({ upside: 0 }), 0);
check('upside string numérico', rdcfUpside({ upside: "7.5" }), 7.5);
check('snapshot null', rdcfUpside(null), null);
check('snapshot undefined', rdcfUpside(undefined), null);
check('JSON inválido', rdcfUpside("{no es json"), null);
check('sin campo upside', rdcfUpside({ wacc: 9 }), null);
check('upside no numérico', rdcfUpside({ upside: "barato" }), null);
check('upside NaN', rdcfUpside({ upside: NaN }), null);
check('snapshot numérico', rdcfUpside(3), null);

// ── rdcfCheapTriggered ──────────────────────────────────────────────────────────
check('pasa de caro a barato dispara', rdcfCheapTriggered(-5, 8), true);
check('cruza desde exactamente 0 dispara', rdcfCheapTriggered(0, 3), true);
check('sigue barato no dispara', rdcfCheapTriggered(4, 8), false);
check('sigue caro no dispara', rdcfCheapTriggered(-9, -2), false);
check('se encarece no dispara', rdcfCheapTriggered(6, -1), false);
check('upside 0 no es barato', rdcfCheapTriggered(-5, 0), false);
check('primera lectura no dispara', rdcfCheapTriggered(null, 20), false);
check('upside actual null no dispara', rdcfCheapTriggered(-5, null), false);

// ── isFresh: un análisis muerto no notifica ─────────────────────────────────────
const NOW = Date.parse("2026-08-18T12:00:00Z");
check('análisis de hoy es fresco', isFresh("2026-08-18", NOW), true);
check('análisis de hace 3 días es fresco', isFresh("2026-08-15", NOW), true);
check('análisis de hace 7 días justo entra', isFresh("2026-08-11T12:00:00Z", NOW), true);
check('análisis de hace 8 días caduca', isFresh("2026-08-10T11:00:00Z", NOW), false);
check('análisis de hace meses caduca', isFresh("2026-02-01", NOW), false);
check('fecha futura se trata como fresca', isFresh("2026-08-19", NOW), true);
check('fecha nula', isFresh(null, NOW), false);
check('fecha vacía', isFresh("", NOW), false);
check('fecha ilegible', isFresh("ayer", NOW), false);
check('ventana configurable', isFresh("2026-08-01", NOW, 30), true);

// ── evaluateAnalysisAlert: la decisión completa ─────────────────────────────────
const alert = (last_value) => ({ last_value });
const analysis = (rating, upside, date = "2026-08-18") => ({
  rating, reverse_dcf: upside == null ? null : { upside }, analysis_date: date,
});

// rating_buy
{
  const r = evaluateAnalysisAlert("rating_buy", alert(2), analysis("BUY", null), NOW);
  check('rating_buy dispara al cruzar', r.fire, true);
  check('rating_buy guarda el código nuevo', r.nextValue, 3);
  check('rating_buy trae detalle', typeof r.detail === "string" && r.detail.length > 0, true);
}
check('rating_buy no re-dispara',
  evaluateAnalysisAlert("rating_buy", alert(3), analysis("BUY", null), NOW).fire, false);
check('rating_buy siembra en la primera',
  evaluateAnalysisAlert("rating_buy", alert(null), analysis("STRONG BUY", null), NOW).fire, false);
// …pero SÍ guarda el valor sembrado, o nunca detectaría la transición siguiente.
check('rating_buy siembra last_value aunque no dispare',
  evaluateAnalysisAlert("rating_buy", alert(null), analysis("STRONG BUY", null), NOW).nextValue, 4);
check('rating_buy con análisis viejo no dispara',
  evaluateAnalysisAlert("rating_buy", alert(2), analysis("BUY", null, "2026-01-01"), NOW).fire, false);
check('rating_buy sin análisis no dispara',
  evaluateAnalysisAlert("rating_buy", alert(2), null, NOW).fire, false);
check('rating_buy sin análisis no pisa last_value',
  evaluateAnalysisAlert("rating_buy", alert(2), null, NOW).nextValue, null);

// rdcf_cheap
{
  const r = evaluateAnalysisAlert("rdcf_cheap", alert(-3), analysis("CAUTION", 11.2), NOW);
  check('rdcf_cheap dispara al pasar a positivo', r.fire, true);
  check('rdcf_cheap guarda el upside', r.nextValue, 11.2);
  check('rdcf_cheap menciona la cifra', r.detail.includes("11.2"), true);
}
check('rdcf_cheap no re-dispara',
  evaluateAnalysisAlert("rdcf_cheap", alert(5), analysis("BUY", 9), NOW).fire, false);
check('rdcf_cheap siembra en la primera',
  evaluateAnalysisAlert("rdcf_cheap", alert(null), analysis("BUY", 9), NOW).fire, false);
check('rdcf_cheap con análisis viejo no dispara',
  evaluateAnalysisAlert("rdcf_cheap", alert(-3), analysis("BUY", 9, "2026-03-01"), NOW).fire, false);
check('rdcf_cheap sin snapshot no dispara',
  evaluateAnalysisAlert("rdcf_cheap", alert(-3), analysis("BUY", null), NOW).fire, false);

// Kind desconocido: nunca dispara (una fila corrupta no debe notificar).
check('kind desconocido no dispara',
  evaluateAnalysisAlert("qué_es_esto", alert(1), analysis("BUY", 9), NOW).fire, false);

// El cron consulta exactamente estos kinds.
check('ANALYSIS_KINDS son los dos esperados', ANALYSIS_KINDS.join(","), "rating_buy,rdcf_cheap");

// Invariante general: la función nunca lanza, sea cual sea la basura de entrada.
for (const k of [...ANALYSIS_KINDS, "otro"]) {
  for (const a of [null, undefined, {}, alert(null), alert("x")]) {
    for (const an of [null, undefined, {}, analysis(null, null), analysis("BUY", "x")]) {
      try {
        const r = evaluateAnalysisAlert(k, a, an, NOW);
        if (typeof r.fire !== "boolean") { bad++; n++; console.log(`FAIL  fire no booleano (${k})`); }
        else n++;
      } catch (e) { bad++; n++; console.log(`FAIL  evaluateAnalysisAlert lanzó con (${k}): ${e.message}`); }
    }
  }
}

console.log(`\n${bad === 0 ? "✓" : "✗"} alertKinds: ${n - bad} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
