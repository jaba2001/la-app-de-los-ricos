// ─────────────────────────────────────────────────────────────────────────────
// LAS VENTANAS DE UN RANKING
//
// El caso que motivó el módulo: con `slice(-21)` la ventana mensual de `MNST` incluyó una caída
// del −50,7 % SIN el rebote del +94,1 %.
//
// ⚠️ Y estos tests fijan algo que descubrí escribiéndolos: la ventana de calendario **también lo
// parte**, por el otro lado. Ninguna ventana protege de un dato roto — de eso protege
// `lib/integridadPrecios.ts`. Lo que aporta el calendario es reproducibilidad.
//
//   node --experimental-strip-types --no-warnings scripts/ventanas.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { menosDias, inicioDe, tramoDe, retornoEnTramo, VENTANAS } from "../lib/ventanas.ts";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✖ ${msg}`); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`);

// ── Aritmética de fechas ─────────────────────────────────────────────────────────────────
eq(menosDias("2026-08-31", 7), "2026-08-24", "menosDias resta días naturales");
eq(menosDias("2026-03-01", 1), "2026-02-28", "cruza fin de mes");
eq(menosDias("2024-03-01", 1), "2024-02-29", "y un 29 de febrero");
eq(inicioDe("ytd", "2026-08-31"), "2026-01-01", "YTD empieza el 1 de enero del año del cierre");
eq(inicioDe("1d", "2026-08-31"), null, "1d no se resuelve por calendario: lo pone la sesión anterior");

// ── Sesiones de un mes con un fin de semana en medio ─────────────────────────────────────
const sesiones = [
  "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31",
  "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07",
  "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
  "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21",
  "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-31",
];

// ── «1 día» es la SESIÓN anterior, no el día natural anterior ────────────────────────────
{
  const t = tramoDe(sesiones, "1d", "2026-08-03");   // lunes: el día natural anterior es domingo
  eq(t, { base: "2026-07-31", hasta: "2026-08-03" }, "el lunes compara contra el viernes, no contra el domingo");
}

// ── NINGUNA ventana protege de un dato roto ──────────────────────────────────────────────
// Este bloque existe para dejar constancia de una creencia MÍA que era falsa. Escribí que una
// ventana de calendario evitaría partir el artefacto de `MNST` (caída el 2026-07-31, rebote el
// 2026-08-03). No es cierto: lo parte igual, sólo que por el otro lado.
//
// De un dato roto protege `lib/integridadPrecios.ts`, que mira la serie entera. La ventana es
// una cuestión de reproducibilidad, no de integridad — y confundir las dos cosas es cómo se
// acaba confiando en la protección equivocada.
{
  const t = tramoDe(sesiones, "1m", "2026-08-31");
  ok(t !== null, "hay tramo mensual");
  const dentro = (f) => f > t.base && f <= t.hasta;
  ok(dentro("2026-07-31") === false && dentro("2026-08-03") === true,
    `la ventana de calendario TAMBIÉN parte el artefacto (base ${t.base}) — por eso hace falta el guardián`);

  const porBarras = sesiones.slice(-21);
  ok(porBarras.includes("2026-07-31") !== porBarras.includes("2026-08-03"),
    "y slice(-21) lo parte igual, por el otro lado: ninguna de las dos salva");
}

// ── Lo que SÍ aporta la ventana de calendario: reproducibilidad ──────────────────────────
{
  // Mismo cierre y mismo calendario ⇒ mismo tramo, siempre.
  const a1 = tramoDe(sesiones, "1m", "2026-08-31");
  const a2 = tramoDe([...sesiones], "1m", "2026-08-31");
  eq(a1, a2, "el tramo es determinista");

  // Y con un festivo de más en medio, «un mes» sigue siendo un mes natural — no 21 sesiones
  // que ahora abarcan cinco semanas.
  const conFestivo = sesiones.filter((f) => f !== "2026-08-17");
  const t = tramoDe(conFestivo, "1m", "2026-08-31");
  ok(t.hasta === "2026-08-31" && t.base >= "2026-07-27",
    `quitar una sesión no estira la ventana hacia atrás (${t.base} → ${t.hasta})`);
  ok(conFestivo.slice(-21)[0] < sesiones.slice(-21)[0],
    "mientras que slice(-21) SÍ se estira: mide un tramo distinto según los festivos que hubo");
}

// ── El tramo se publica con las fechas REALES ────────────────────────────────────────────
{
  const t = tramoDe(sesiones, "1s", "2026-08-31");
  ok(sesiones.includes(t.base) && sesiones.includes(t.hasta),
    `las dos fechas del tramo son sesiones de verdad (${t.base} → ${t.hasta})`);
  ok(t.base === "2026-08-21",
    `la BASE es el último cierre antes de la ventana, no el primer día de ella (${t.base})`);
}

// ── Bordes ───────────────────────────────────────────────────────────────────────────────
{
  eq(tramoDe([], "1m", "2026-08-31"), null, "sin sesiones no hay tramo");
  eq(tramoDe(["2026-08-31"], "1d", "2026-08-31"), null, "con una sola sesión no hay «1 día»");
  eq(tramoDe(sesiones, "1m", "2020-01-01"), null, "una fecha anterior a toda la serie no da tramo");
}

// ── El retorno del tramo ─────────────────────────────────────────────────────────────────
{
  const serie = [
    { date: "2026-08-27", ret: Math.log(1.10) },
    { date: "2026-08-28", ret: Math.log(1.10) },
    { date: "2026-08-31", ret: Math.log(1.10) },
  ];
  const r = retornoEnTramo(serie, "2026-08-27", "2026-08-31");
  ok(Math.abs(r.pct - 21) < 0.01, `compone bien: dos subidas del 10 % dan ${r.pct.toFixed(2)} %`);
  eq(r.sesiones, 2, "y cuenta las sesiones que USÓ, no las que pidió");
  ok(r.desde === undefined, "no inventa campos");

  // La barra de `desde` NO entra: es el punto de partida, no un retorno de la ventana.
  const soloUna = retornoEnTramo(serie, "2026-08-28", "2026-08-31");
  eq(soloUna.sesiones, 1, "la sesión de partida queda fuera del cómputo");

  // Los huecos se cuentan, no se tapan.
  const conHueco = retornoEnTramo(
    [{ date: "2026-08-28", ret: NaN }, { date: "2026-08-31", ret: Math.log(1.1) }],
    "2026-08-27", "2026-08-31",
  );
  eq(conHueco.huecos, 1, "un retorno no finito se CUENTA como hueco");
  eq(conHueco.sesiones, 1, "y no se suma como si fuera cero");

  eq(retornoEnTramo([], "2026-01-01", "2026-08-31"), null, "sin sesiones en el tramo, null");
}

// ── Las cuatro ventanas están declaradas ─────────────────────────────────────────────────
eq(VENTANAS.map((v) => v.id), ["1d", "1s", "1m", "ytd"], "las cuatro ventanas del producto");

console.log(pass && !fail ? `\n✓ ventanas: ${pass} passed, 0 failed\n` : `\n✖ ventanas: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
