// ─────────────────────────────────────────────────────────────────────────────
// GUARDIÁN DE LO QUE SE PUBLICA CON PRECIOS
//
// `lib/integridadPrecios.ts` decide si una serie se puede enseñar en una página pública. Sus
// umbrales NO son los del backtest, y este fichero fija por qué: allí `GME` +135 % es real y
// tirarlo sesgaría la referencia; aquí un +177 % hay que marcarlo aunque sea cierto.
//
//   node --experimental-strip-types --no-warnings scripts/integridad.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { revisarSerie, veredicto, cierresDesalineados, UMBRALES } from "../lib/integridadPrecios.ts";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✖ ${msg}`); } };

/** Serie sintética con un factor de ajuste constante. */
const serie = (precios, desde = "2026-01-05", factor = 1) =>
  precios.map((p, i) => ({
    date: new Date(Date.parse(desde) + i * 86400000).toISOString().slice(0, 10),
    raw: p * factor,
    adj: p,
  }));

// ── Una serie normal no dice nada ────────────────────────────────────────────────────────
{
  const s = serie([100, 101, 99, 102, 103, 101, 104]);
  const a = revisarSerie(s);
  ok(a.length === 0, `una serie tranquila no genera avisos (salieron ${a.length})`);
  ok(veredicto(a).publicable, "y es publicable");
}

// ── El caso MNST: se parte por la mitad y vuelve ─────────────────────────────────────────
// Es el que motivó el módulo. `saltoImposible` no lo ve porque mira barras sueltas con el listón
// en +300 %; aquí lo caza la ida y vuelta.
{
  const s = serie([100, 100, 49, 98, 99]);
  const a = revisarSerie(s);
  const iv = a.filter((x) => x.tipo === "ida_y_vuelta");
  ok(iv.length >= 1, `la ida y vuelta se detecta (avisos: ${JSON.stringify(a.map((x) => x.tipo))})`);
  ok(iv[0]?.gravedad === "alta", "y es de gravedad alta");
  const v = veredicto(a);
  ok(!v.publicable, "una ida y vuelta impide publicar sin marcar");
  ok(/neto/.test(String(v.motivo)), `el motivo explica el neto (${v.motivo})`);
}

// ── Un desplome REAL no es una ida y vuelta ──────────────────────────────────────────────
// `EIX` cayó −23 % y siguió cayendo. Eso es mercado y tiene que publicarse.
{
  const s = serie([100, 98, 75, 73, 71, 68]);
  const a = revisarSerie(s);
  ok(!a.some((x) => x.tipo === "ida_y_vuelta"), "una caída sostenida NO es ida y vuelta");
  ok(veredicto(a).publicable, "y sigue siendo publicable");
}

// ── Un salto grande de verdad se marca, pero no bloquea ──────────────────────────────────
// `MRNA` +177 % que no revierte: puede ser real. Se avisa, no se esconde.
{
  const s = serie([60, 62, 174, 133, 145, 140]);
  const a = revisarSerie(s);
  ok(a.some((x) => x.tipo === "salto"), "un +180 % que no revierte se marca como salto");
  ok(!a.some((x) => x.tipo === "ida_y_vuelta"), "pero NO como ida y vuelta: no vuelve");
  const v = veredicto(a);
  ok(v.publicable, "se publica igualmente — puede ser real");
  ok(/con aviso/.test(String(v.motivo)), `pero con su aviso al lado (${v.motivo})`);
}

// ── El umbral es el propio, NO el del backtest ───────────────────────────────────────────
{
  ok(UMBRALES.saltoArriba < Math.log(4), "el umbral de esta capa es MÁS BAJO que el +300 % del backtest");
  const s = serie([100, 277]);   // +177 %, el caso MRNA
  ok(revisarSerie(s).some((x) => x.tipo === "salto"),
    "un +177 % se marca aquí, y en el backtest (log 4) no se marcaría");
}

// ── El factor de ajuste ──────────────────────────────────────────────────────────────────
{
  // Factor constante: nada que decir.
  const limpia = serie([100, 101, 102], "2026-01-05", 2);
  ok(!revisarSerie(limpia).some((x) => x.tipo === "factor_ajuste"), "factor constante, sin aviso");

  // Factor que salta a mitad de serie (el 2,000 → 1,000 de MNST).
  const rota = [
    { date: "2026-08-06", raw: 200, adj: 100 },
    { date: "2026-08-07", raw: 202, adj: 101 },
    { date: "2026-08-11", raw: 100, adj: 100 },
  ];
  const a = revisarSerie(rota);
  ok(a.some((x) => x.tipo === "factor_ajuste"), "un salto del factor se detecta");
  ok(a.find((x) => x.tipo === "factor_ajuste")?.gravedad === "media",
    "pero es de gravedad MEDIA: un split legítimo también cambia el factor");
  ok(/split legítimo/.test(String(a.find((x) => x.tipo === "factor_ajuste")?.detalle)),
    "y el texto lo dice, para que nadie lo lea como veredicto");
}

// ── Un DIVIDENDO no es un split ──────────────────────────────────────────────────────────
// El fallo que tuvo la primera version: el umbral era 0,01 ABSOLUTO sobre el factor, y el
// ajustado descuenta dividendos, asi que saltaba en cada fecha ex-dividendo. Once nombres del
// S&P 500 marcados en un mes —BX, CLX, DOW, F, IP, KVUE, LYB, TAP, OKE, PRU, UPS— todos por eso.
// Medido: CLX -1,15 %, UPS -1,57 %, BX -1,00 %. Frente a MNST, -50 %.
{
  // Factor 1,0117 -> 1,0000: un dividendo trimestral tipico (el caso real de CLX).
  const dividendo = [
    { date: "2026-08-11", raw: 101.17, adj: 100 },
    { date: "2026-08-12", raw: 101.00, adj: 101 },
    { date: "2026-08-13", raw: 102.00, adj: 102 },
  ];
  ok(!revisarSerie(dividendo).some((x) => x.tipo === "factor_ajuste"),
    "un dividendo (~1 % del factor) NO se marca como salto de escala");

  // Factor 2,0 -> 1,0: la escala de MNST. Ese si.
  const escala = [
    { date: "2026-08-06", raw: 200, adj: 100 },
    { date: "2026-08-11", raw: 100, adj: 100 },
  ];
  ok(revisarSerie(escala).some((x) => x.tipo === "factor_ajuste"),
    "un cambio de escala del 50 % SI se marca");

  // Y el liston esta donde separa a los dos, con holgura por ambos lados.
  ok(UMBRALES.factorRelativo > 0.02 && UMBRALES.factorRelativo < 0.25,
    `el umbral del factor (${UMBRALES.factorRelativo}) esta entre un dividendo (~2 %) y el split mas pequeno (5:4 = 25 %)`);
}

// ── Un aviso NUNCA sale sin motivo ───────────────────────────────────────────────────────
// La primera version solo miraba los de tipo `salto`, asi que los de `factor_ajuste` salian
// con motivo nulo: marcados y sin decir por que. Un aviso mudo ocupa sitio y no informa.
{
  const s = [
    { date: "2026-08-06", raw: 200, adj: 100 },
    { date: "2026-08-11", raw: 100, adj: 100 },
  ];
  const v = veredicto(revisarSerie(s));
  ok(v.enVentana.length > 0, "hay avisos");
  ok(v.motivo != null, `y el motivo NO es nulo (salio: ${v.motivo})`);
}

// ── Los datos que faltan no son un salto ─────────────────────────────────────────────────
{
  const s = [
    { date: "2026-01-05", raw: 100, adj: 100 },
    { date: "2026-01-06", raw: null, adj: null },
    { date: "2026-01-07", raw: 101, adj: 101 },
  ];
  ok(revisarSerie(s).length === 0, "una barra sin datos se salta, no se inventa un movimiento");
  ok(revisarSerie([]).length === 0, "una serie vacía no revienta");
}

// ── La ventana acota el veredicto ────────────────────────────────────────────────────────
// Un artefacto de hace tres años no impide publicar el ranking de este mes.
{
  const s = serie([100, 100, 49, 98, 99], "2020-01-05");
  const a = revisarSerie(s);
  ok(!veredicto(a).publicable, "sin ventana, el artefacto de 2020 bloquea");
  ok(veredicto(a, "2026-01-01").publicable, "acotando a 2026, ya no: no cae en la ventana");
}

// ── Cierres desalineados ─────────────────────────────────────────────────────────────────
{
  const r = cierresDesalineados([
    { ticker: "A", fecha: "2026-08-31" },
    { ticker: "B", fecha: "2026-08-31" },
    { ticker: "C", fecha: "2026-08-28" },
  ]);
  ok(r.referencia === "2026-08-31", "la referencia es la fecha mayoritaria");
  ok(r.fuera.length === 1 && r.fuera[0].ticker === "C", "y se dice QUIÉN se desalinea, no sólo que pasa");
  ok(cierresDesalineados([]).referencia === null, "sin series, no hay referencia");
}

console.log(pass && !fail ? `\n✓ integridad: ${pass} passed, 0 failed\n` : `\n✖ integridad: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
