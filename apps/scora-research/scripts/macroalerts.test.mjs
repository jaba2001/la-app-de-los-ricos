// Guard de lib/server/macroAlerts.js — qué se notifica a TODAS las suscripciones a la vez.
//   node scripts/macroalerts.test.mjs
//
// POR QUÉ EXISTE: esta decisión se envía a todo el mundo de golpe y no hay forma de
// retirarla. Los tres fallos que importan: (a) no avisar de un cambio de régimen, que es
// el evento más valioso que produce el motor; (b) avisar en bucle o el primer día por algo
// que llevaba meses igual; (c) redactar una INSTRUCCIÓN en vez de un estado. Los tres se
// comprueban aquí.
import { macroAlertFor, regimeChanged, regimeId } from "../lib/server/macroAlerts.js";

let bad = 0, n = 0;
function check(label, got, want) {
  n++;
  if (got !== want) { bad++; console.log(`FAIL  ${label}\n      got:  ${got}\n      want: ${want}`); }
}
function ok(label, cond) { n++; if (!cond) { bad++; console.log(`FAIL  ${label}`); } }

// ── regimeId: normalización ─────────────────────────────────────────────────────
check('regimeId normaliza a minúsculas', regimeId({ regime_id: "EXPANSION" }), "expansion");
check('regimeId recorta espacios', regimeId({ regime_id: "  contraction " }), "contraction");
check('regimeId sin fila', regimeId(null), null);
check('regimeId sin campo', regimeId({}), null);
check('regimeId cadena vacía', regimeId({ regime_id: "   " }), null);
check('regimeId no-string', regimeId({ regime_id: 3 }), null);

// ── regimeChanged: transición, con siembra ──────────────────────────────────────
check('cambio real', regimeChanged("expansion", "contraction"), true);
check('mismo régimen no es cambio', regimeChanged("expansion", "expansion"), false);
// Sin esto, el primer pase tras desplegar avisaría a todos por algo que no ha cambiado.
check('primera observación siembra, no dispara', regimeChanged(null, "contraction"), false);
check('régimen actual desconocido no dispara', regimeChanged("expansion", null), false);
check('ambos nulos', regimeChanged(null, null), false);

// ── macroAlertFor: el cambio de régimen manda ───────────────────────────────────
const calm = { regime_id: "expansion", regime_confirmation: "confirmed", risk_on: 62, breadth_200dma: 58 };

{
  const a = macroAlertFor({ ...calm, regime_id: "contraction" }, "expansion");
  check('cambio de régimen: clave con el régimen dentro', a.key, "regime:contraction");
  ok('cambio de régimen: menciona de dónde viene', a.body.includes("from expansion to contraction"));
  ok('cambio de régimen: dice que está confirmado', a.body.includes("confirmed"));
  ok('cambio de régimen: título legible', a.title.includes("regime moved to contraction"));
  check('cambio de régimen: devuelve el régimen', a.regime, "contraction");
}
{
  // Un régimen sin confirmar es una lectura provisional y hay que decirlo.
  const a = macroAlertFor({ regime_id: "slowdown", regime_confirmation: "pending", risk_on: 62, breadth_200dma: 58 }, "expansion");
  ok('régimen sin confirmar se declara como tal', a.body.includes("not yet confirmed"));
}
// La clave lleva el régimen, así que el dedupe del cron (comparar con la última enviada)
// vuelve a disparar si el régimen cambia OTRA VEZ, pero no si se queda igual.
{
  const a1 = macroAlertFor({ ...calm, regime_id: "contraction" }, "expansion");
  const a2 = macroAlertFor({ ...calm, regime_id: "recovery" }, "contraction");
  ok('claves distintas para régimenes distintos', a1.key !== a2.key);
  check('segundo cambio tiene su propia clave', a2.key, "regime:recovery");
}
// Sin cambio de régimen: se conserva EXACTAMENTE la lógica anterior.
check('mismo régimen y todo tranquilo → nada que enviar', macroAlertFor(calm, "expansion").key, "ok");
check('primera observación no inventa un cambio', macroAlertFor(calm, null).key, "ok");

// ── Divergencia y risk-off: comportamiento previo intacto ───────────────────────
check('divergencia por gap ≥ 12', macroAlertFor({ ...calm, risk_on: 70, breadth_200dma: 55 }, "expansion").key, "divergence");
check('gap de 11 no es divergencia', macroAlertFor({ ...calm, risk_on: 66, breadth_200dma: 55 }, "expansion").key, "ok");
check('gap exactamente 12 sí lo es', macroAlertFor({ ...calm, risk_on: 67, breadth_200dma: 55 }, "expansion").key, "divergence");
check('confirmación divergent-bearish guardada', macroAlertFor({ ...calm, regime_confirmation: "divergent-bearish" }, "expansion").key, "divergence");
check('risk-off por debajo de 40', macroAlertFor({ ...calm, risk_on: 32, breadth_200dma: 30 }, "expansion").key, "risk-off");
check('risk_on 40 exacto no es risk-off', macroAlertFor({ ...calm, risk_on: 40, breadth_200dma: 38 }, "expansion").key, "ok");

// El cambio de régimen tiene prioridad sobre las otras dos: reconfigura la lectura entera.
{
  const a = macroAlertFor({ regime_id: "contraction", regime_confirmation: "confirmed", risk_on: 30, breadth_200dma: 10 }, "expansion");
  check('el cambio de régimen gana a risk-off y divergencia', a.key, "regime:contraction");
}

// ── Redacción: estado, nunca instrucción ────────────────────────────────────────
// Es la línea que separa "herramienta educativa" de "asesoramiento financiero", y una
// notificación es donde más fácil se cruza.
const PROHIBIDAS = [
  /\bbuy\b/i, /\bsell\b/i, /\bshort\b/i, /\bshould\b/i, /\bmust\b/i,
  /\bget out\b/i, /\bload up\b/i, /\btake profit\b/i, /\bwe recommend\b/i,
];
const TODAS = [
  macroAlertFor({ ...calm, regime_id: "contraction" }, "expansion"),
  macroAlertFor({ ...calm, regime_id: "recovery", regime_confirmation: "pending" }, "contraction"),
  macroAlertFor({ ...calm, risk_on: 70, breadth_200dma: 55 }, "expansion"),
  macroAlertFor({ ...calm, risk_on: 32, breadth_200dma: 30 }, "expansion"),
];
for (const a of TODAS) {
  const texto = `${a.title} ${a.body}`;
  for (const re of PROHIBIDAS) {
    ok(`sin instrucción (${a.key}): ${re}`, !re.test(texto));
  }
  ok(`título no vacío (${a.key})`, typeof a.title === "string" && a.title.length > 0);
  ok(`cuerpo no vacío (${a.key})`, typeof a.body === "string" && a.body.length > 20);
  // Los push se truncan; si no cabe el titular, la alerta no comunica.
  ok(`título por debajo de 65 chars (${a.key}): ${a.title.length}`, a.title.length <= 65);
  ok(`cuerpo por debajo de 240 chars (${a.key}): ${a.body.length}`, a.body.length <= 240);
  ok(`sin fugas de null/undefined/NaN (${a.key})`, !/null|undefined|NaN/.test(texto));
}

// ── Invariante: nunca lanza, con cualquier basura ───────────────────────────────
for (const m of [null, undefined, {}, { regime_id: 5 }, { risk_on: "x", breadth_200dma: "y" }, { regime_id: "expansion", risk_on: null }]) {
  for (const p of [null, undefined, "expansion", "", 7]) {
    try {
      const a = macroAlertFor(m, p);
      ok('macroAlertFor devuelve una clave string', typeof a.key === "string" && a.key.length > 0);
    } catch (e) { bad++; n++; console.log(`FAIL  macroAlertFor lanzó: ${e.message}`); }
  }
}
// Una fila sin nada medible no puede acabar notificando.
check('macro vacío no notifica', macroAlertFor({}, "expansion").key, "ok");
check('macro null no notifica', macroAlertFor(null, "expansion").key, "ok");

console.log(`\n${bad === 0 ? "✓" : "✗"} macroAlerts: ${n - bad} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
