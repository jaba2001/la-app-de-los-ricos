// Cola de micro-agrupación (lib/batchQueue.ts).
//   node --experimental-strip-types --no-warnings scripts/batchqueue.test.mjs
//
// POR QUÉ EXISTE: esta capa se mete DEBAJO de las 33 llamadas que hace la página de un
// ticker sin que ninguna de ellas se entere. Si reparte mal las respuestas, cada pantalla
// enseñará datos de otra empresa sin que nada falle de forma visible — el peor tipo de bug
// que puede tener un producto de análisis financiero. Por eso lo que más se prueba aquí es
// el reparto: mismo path dos veces, respuesta que falta, lote entero caído.
import { createBatcher } from "../lib/batchQueue.ts";

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`FAIL  ${label}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

// Vaciado manual: la prueba decide cuándo sale el lote, así no depende de temporizadores.
const manual = () => { let fns = []; return { schedule: (f) => fns.push(f), run: () => { const c = fns; fns = []; c.forEach((f) => f()); } }; };
const ok = (id, obj) => ({ id, status: 200, body: JSON.stringify(obj) });

// ── Agrupa lo del mismo tick en UNA llamada ─────────────────────────────────────────
{
  const m = manual();
  const sent = [];
  const b = createBatcher({
    send: async (reqs) => { sent.push(reqs); return { results: reqs.map((r, i) => ok(r.id, { n: i })) }; },
    single: async () => { throw new Error("no debería usarse"); },
  }, { schedule: m.schedule });

  const ps = [b.enqueue("/api/fmp/quote?symbol=AAPL"), b.enqueue("/api/fmp/profile?symbol=AAPL"), b.enqueue("/api/edgar?symbol=AAPL")];
  check("encoladas antes de vaciar", b._pending(), 3);
  m.run();
  const res = await Promise.all(ps);
  check("una sola llamada", sent.length, 1);
  check("con las 3 dentro", sent[0].length, 3);
  check("reparto en orden", res, [{ n: 0 }, { n: 1 }, { n: 2 }]);
}

// ── La misma ruta dos veces NO se pisa (ticker + SPY es el caso real) ───────────────
{
  const m = manual();
  const b = createBatcher({
    send: async (reqs) => ({ results: reqs.map((r) => ok(r.id, { path: r.path, id: r.id })) }),
    single: async () => { throw new Error("no"); },
  }, { schedule: m.schedule });
  const p1 = b.enqueue("/api/fmp/historical-price-eod/full?symbol=AAPL");
  const p2 = b.enqueue("/api/fmp/historical-price-eod/full?symbol=SPY");
  m.run();
  const [a, c] = await Promise.all([p1, p2]);
  check("ids distintos por posicion", [a.id, c.id], ["0", "1"]);
  check("no se pisan", a.path !== c.path, true);
}

// ── Errores por sub-petición ────────────────────────────────────────────────────────
{
  const m = manual();
  const b = createBatcher({
    send: async () => ({ results: [{ id: "0", status: 403, body: '{"error":"Endpoint not allowed"}' }, { id: "1", status: 200, body: "no-es-json" }] }),
    single: async () => { throw new Error("no"); },
  }, { schedule: m.schedule });
  const p1 = b.enqueue("/api/fmp/prohibido");
  const p2 = b.enqueue("/api/fmp/quote?symbol=A");
  m.run();
  const r1 = await p1.then(() => "resolvio", (e) => e.message);
  const r2 = await p2.then(() => "resolvio", (e) => "rechazo");
  check("403 → error con el formato de siempre", r1, '[proxy 403] /api/fmp/prohibido: {"error":"Endpoint not allowed"}');
  check("cuerpo no-JSON → rechaza", r2, "rechazo");
}

// ── Respuesta que falta: rechaza, no cuelga ─────────────────────────────────────────
{
  const m = manual();
  const b = createBatcher({
    send: async () => ({ results: [] }),
    single: async () => { throw new Error("no"); },
  }, { schedule: m.schedule });
  const p = b.enqueue("/api/fmp/quote?symbol=A");
  m.run();
  check("sin respuesta → rechaza", await p.then(() => "resolvio", (e) => e.message.startsWith("[batch] sin respuesta")), true);
}

// ── Lote caído → cada petición por su cuenta ────────────────────────────────────────
{
  const m = manual();
  const singles = [];
  const b = createBatcher({
    send: async () => { throw new Error("404 /api/batch"); },
    single: async (path) => { singles.push(path); return { via: "single", path }; },
  }, { schedule: m.schedule });
  const ps = [b.enqueue("/api/fmp/quote?symbol=A"), b.enqueue("/api/edgar?symbol=A")];
  m.run();
  const res = await Promise.all(ps);
  check("degrada a sueltas", singles.length, 2);
  check("y devuelve el dato igual", res.map((r) => r.via), ["single", "single"]);
}

// ── Se parte en trozos de maxBatch ──────────────────────────────────────────────────
{
  const m = manual();
  const sizes = [];
  const b = createBatcher({
    send: async (reqs) => { sizes.push(reqs.length); return { results: reqs.map((r) => ok(r.id, {})) }; },
    single: async () => { throw new Error("no"); },
  }, { schedule: m.schedule, maxBatch: 40 });
  const ps = Array.from({ length: 45 }, (_, i) => b.enqueue(`/api/fmp/quote?symbol=T${i}`));
  m.run();
  await Promise.all(ps);
  check("45 → dos lotes", sizes, [40, 5]);
}

// ── Ticks distintos, lotes distintos ────────────────────────────────────────────────
{
  const m = manual();
  let n = 0;
  const b = createBatcher({
    send: async (reqs) => { n++; return { results: reqs.map((r) => ok(r.id, {})) }; },
    single: async () => { throw new Error("no"); },
  }, { schedule: m.schedule });
  const p1 = b.enqueue("/api/fmp/quote?symbol=A"); m.run(); await p1;
  const p2 = b.enqueue("/api/fmp/quote?symbol=B"); m.run(); await p2;
  check("dos ticks → dos lotes", n, 2);
}

console.log(bad ? `\nbatchQueue: ${bad} fallo(s)` : "\nbatchQueue: 14 comprobaciones OK");
process.exit(bad ? 1 : 0);
