// ─────────────────────────────────────────────────────────────────────────────
// LA CAPA DE TIPOS
//
// Lo que fija este fichero no es la resta 10a − 2a, que es aritmética. Es lo que se puede
// hacer mal y queda bonito:
//
//   1. Que un dato AUSENTE no se convierta en un cero con forma de respuesta — una curva
//      sin el tramo de 2 años no es una curva plana.
//   2. Que un PERCENTIL no se dé sobre una muestra que no lo sostiene. Es el error que ya
//      cometimos al confundir la serie de ICE BofA (786 obs desde 2023) con "41 años".
//   3. Que "ensanchándose" sea una afirmación con corte declarado y no el signo de una resta.
//
//   node --experimental-strip-types --no-warnings scripts/tipos.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { pendiente, forma, descomponer, percentil, credito, liston, avisoConTasaBase, lecturaTipoReal, BASE_AVISO, SENSIBILIDAD_REAL, UMBRALES_TIPOS } from "../lib/tipos.ts";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };
const cerca = (a, b, tol, m) => ok(a != null && Math.abs(a - b) <= tol, `${m} — esperado ${b}, salió ${a}`);

// ── La forma de la curva ─────────────────────────────────────────────────────────────────
{
  const normal = { m3: 4.0, a2: 4.2, a10: 4.8, a30: 5.0 };
  const f = forma(normal);
  ok(f.forma === "normal", `curva ascendente = normal (salió ${f.forma})`);
  cerca(f.t10y2, 0.6, 1e-9, "pendiente 10a-2a");
  cerca(f.t10y3m, 0.8, 1e-9, "pendiente 10a-3m");

  // 2023: el 3 meses pagaba más que el 10 años. La inversión más citada del mercado.
  ok(forma({ m3: 5.4, a2: 4.9, a10: 4.2, a30: 4.3 }).forma === "invertida", "10a por debajo del 2a = invertida");

  // Justo en el umbral NO es plana: los cortes son estrictos y eso hay que fijarlo.
  ok(forma({ m3: 4, a2: 4, a10: 4 + UMBRALES_TIPOS.planaHasta, a30: 5 }).forma === "normal",
     "exactamente en el umbral de planitud todavía es normal");
  ok(forma({ m3: 4, a2: 4, a10: 4.1, a30: 5 }).forma === "plana", "por debajo del umbral, plana");

  // ⚠️ La joroba: el tramo medio por encima de los DOS extremos. Casi nadie la codifica.
  ok(forma({ m3: 3.5, a2: 4.6, a10: 4.4, a30: 4.0 }).forma === "jorobada", "tramo medio sobre los dos extremos = jorobada");
}

// ── LO QUE MÁS IMPORTA (1): ausente NO es cero ───────────────────────────────────────────
{
  ok(pendiente(4.8, null) === null, "sin el tramo corto no hay pendiente — NO es cero");
  ok(pendiente(null, null) === null, "sin ninguno de los dos, tampoco");
  ok(forma({ m3: null, a2: null, a10: null, a30: null }) === null, "una curva vacía no tiene forma");
  ok(forma({ m3: null, a2: null, a10: 4.8, a30: 5 }) === null, "con un solo punto no se puede afirmar la forma");
  // Con UN par completo sí se puede, y se dice cuál falta.
  const p = forma({ m3: 4.0, a2: null, a10: 4.8, a30: null });
  ok(p != null && p.t10y2 === null && p.t10y3m != null, "con 3m y 10a sí hay forma, y el par que falta queda en null");
  ok(descomponer(4.8, null) === null, "sin tipo real no hay descomposición");
  ok(descomponer(null, 2.1) === null, "ni sin nominal");
  ok(liston(null) === null, "sin el 10 años no hay listón que enseñar");
  ok(credito([], "2026-09-01") === null, "sin serie no hay diferencial");
}

// ── LO QUE MÁS IMPORTA (2): un percentil necesita muestra ────────────────────────────────
// ⚠️ Este bloque existe por un error REAL de este repo: dar por buena la serie de ICE BofA
// creyendo que traía historia larga cuando FRED sólo sirve 786 obs desde 2023-09.
{
  const corta = Array.from({ length: UMBRALES_TIPOS.minObsPercentil - 1 }, (_, i) => i);
  const r = percentil(50, corta);
  ok(r.pct === null, "muestra por debajo del mínimo: NO se da percentil");
  ok(/insuficiente/.test(r.motivo) && /\d/.test(r.motivo), "y se dice cuántas obs hay y cuántas hacen falta");

  const larga = Array.from({ length: 1000 }, (_, i) => i / 10);  // 0 … 99,9
  cerca(percentil(50, larga).pct, 50, 1.5, "en el centro de una uniforme, percentil ~50");
  cerca(percentil(-1, larga).pct, 0, 1e-9, "por debajo de todo, 0");
  cerca(percentil(1000, larga).pct, 100, 1e-9, "por encima de todo, 100");
  ok(percentil(null, larga).pct === null, "sin valor no hay percentil");
  ok(percentil(50, larga).n === 1000, "y se reporta el tamaño de la muestra que lo sostiene");
}

// ── LO QUE MÁS IMPORTA (3): «ensanchándose» es una afirmación, no un signo ────────────────
{
  // 400 días para superar el mínimo de muestra del percentil.
  const dia = (i) => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  const plano = Array.from({ length: 400 }, (_, i) => ({ date: dia(i), v: 2.0 }));
  const c1 = credito(plano, dia(399));
  ok(!c1.ensanchando, "un diferencial quieto no se está ensanchando");
  cerca(c1.delta, 0, 1e-9, "y su delta a 90 días es cero");

  // Sube 0,10 en 90 días: es un movimiento, pero NO llega al corte declarado.
  const leve = plano.map((o, i) => ({ ...o, v: i > 309 ? 2.1 : 2.0 }));
  const c2 = credito(leve, dia(399));
  ok(c2.delta > 0 && !c2.ensanchando, "subir por debajo del corte NO es «ensanchándose»");

  // Sube 0,80: eso sí.
  const fuerte = plano.map((o, i) => ({ ...o, v: i > 309 ? 2.8 : 2.0 }));
  const c3 = credito(fuerte, dia(399));
  ok(c3.ensanchando, "una apertura por encima del corte sí lo es");
  cerca(c3.delta, 0.8, 1e-9, "y se publica el número que lo sostiene");
  ok(c3.hace90d != null, "junto con el valor de referencia de hace 90 días");

  // El percentil del diferencial usa SÓLO la historia hasta la fecha pedida: sin mirar futuro.
  const medio = credito(fuerte, dia(200));
  ok(medio.fecha <= dia(200), "el as-of no mira más allá de la fecha pedida");
  ok(medio.percentil === null && /insuficiente/.test(medio.motivoPercentil),
     "y con 201 obs no inventa un percentil: lo declara insuficiente");
}

// ── La descomposición nominal / real ─────────────────────────────────────────────────────
{
  const d = descomponer(4.80, 2.10, 2.35);
  cerca(d.breakeven, 2.70, 1e-9, "breakeven = nominal - real");
  cerca(d.expectativa5a5, 2.35, 1e-9, "la expectativa 5a5 se devuelve APARTE");
  ok(d.breakeven !== d.expectativa5a5, "porque miden horizontes distintos y no se promedian");
  ok(descomponer(4.80, 2.10).expectativa5a5 === null, "y si no está, es null y no el breakeven");

  const l = liston(4.80, 2.10);
  ok(/4\.80/.test(l) && /2\.10/.test(l), "el listón cita los dos números");
  ok(!/subir|bajar|comprar|vender|va a/i.test(l), "y NO predice nada: es capa explicativa");
}

// ── EL AVISO NUNCA SE PUBLICA SOLO ───────────────────────────────────────────────────────
// ⚠️ Este bloque existe porque la medicion dijo que NO. El aviso se encendio 397 dias antes de
// Lehman, que es una anecdota preciosa; medido sobre 22 episodios independientes en 33 años,
// p = 0,146 y 8 de 22 fueron seguidos de un año de mas del +20 %. El mecanismo es cierto y la
// señal no sobrevive al test, asi que el booleano no puede salir sin su tasa base al lado.
{
  const t = avisoConTasaBase(true);
  ok(/22/.test(t) && /8/.test(t), "el aviso encendido cita cuantos episodios hubo y cuantos fallaron");
  ok(/0\.146|0,146/.test(t), "y el p-valor que dice que no se distingue del azar");
  // ⚠️ El punto va ESCAPADO. Sin escapar, `0.146` casa tambien «0x146» o «0,146» por accidente
  // y el test pasaria aunque la cifra estuviera mal. Ya paso en esta sesion con un sed.
  ok(!/0\.146/.test("0X146"), "y el punto escapado no casa cualquier caracter");
  ok(/contexto, no una señal|no una señal/i.test(t), "y se declara explicitamente como contexto, no señal");
  ok(!/comprar|vender|salir|proteger|crisis viene/i.test(t), "y no recomienda nada");
  ok(/no se esta abriendo|no se está abriendo/i.test(avisoConTasaBase(false)), "apagado, dice justo eso");
  ok(BASE_AVISO.p > 0.05, "la tasa base guardada refleja que NO es significativo");
  ok(BASE_AVISO.seguidosDeUnBuenAno / BASE_AVISO.episodios > 0.3, "mas de un tercio de los avisos fueron falsas alarmas");
}

// ── PARIDAD: la web y el artefacto tienen que mirar las MISMAS series ────────────────────
// ⚠️ Este bloque nacio ROTO y el control positivo lo caza: la primera version comprobaba
// `runner.includes(id)` sobre el texto entero del fichero, asi que daba verde porque el ID
// aparecia EN UN COMENTARIO. Cambie BAA10Y por BAMLH0A0HYM2 en el componente y el test siguio
// pasando: comparaba prosa, no codigo. Es la misma familia que el \b sin escapar.
//
// Ahora se extraen los identificadores de donde de verdad se usan: las CLAVES del objeto
// SERIES del runner, y los argumentos de las llamadas `traer("XXX", …)` del componente.
{
  const runner = readFileSync("research/tipos.mjs", "utf8");
  const ui = readFileSync("components/macro/CurvaTipos.tsx", "utf8");

  // Del runner: las claves del contrato de cobertura, no cualquier mencion en el fichero.
  const bloque = runner.slice(runner.indexOf("const SERIES = {"), runner.indexOf("\n};", runner.indexOf("const SERIES = {")));
  const delRunner = new Set([...bloque.matchAll(/^\s{2}(\w+):\s*\{/gm)].map((m) => m[1]));
  // Del componente: solo lo que se PIDE de verdad.
  const delUi = new Set([...ui.matchAll(/traer\(\s*"([A-Z0-9]+)"/g)].map((m) => m[1]));

  ok(delRunner.size >= 7, `el contrato del runner declara ${delRunner.size} series`);
  ok(delUi.size >= 7, `el componente pide ${delUi.size} series`);

  // Toda serie que la web pinta tiene que estar vigilada por el contrato del runner. Si no,
  // la web pintaria un percentil sobre una serie que nadie comprueba que traiga historia.
  for (const id of delUi)
    ok(delRunner.has(id), `el componente pide ${id}, que NO esta en el contrato de cobertura del runner`);

  // Y las que el runner declara para PINTAR tienen que estar en la web. STLFSI4 es la
  // excepcion declarada: el runner la vigila justamente porque nadie la pinta.
  const SOLO_VIGILADAS = new Set(["STLFSI4"]);
  for (const id of delRunner)
    if (!SOLO_VIGILADAS.has(id)) ok(delUi.has(id), `${id} esta en el contrato del runner pero la web no lo pide`);

  // El percentil de la web sale de la misma historia larga: si alguien lo cambia a mensual o
  // recorta el arranque, el numero deja de coincidir con el del artefacto.
  ok(/traer\(\s*"BAA10Y"\s*,\s*"1986-01-01"\s*\)/.test(ui),
     "el componente pide BAA10Y desde 1986, para que su percentil sea el MISMO que el del artefacto");
  ok(/frequency=d/.test(ui), "y en frecuencia diaria, por lo mismo");

  // El aviso no puede publicarse sin su tasa base tampoco en la web, y no como texto suelto:
  // llamando a la funcion que la adjunta.
  ok(/\{\s*avisoConTasaBase\(/.test(ui), "el componente RENDERIZA avisoConTasaBase(), no el booleano solo");
}

// ── EL TIPO REAL: EL NUMERO CONTEMPORANEO NUNCA SALE SOLO ────────────────────────────────
// ⚠️ Dos de los cuatro videos afirman que cuando el tipo real baja, el oro sube. Es CIERTO y
// enorme: +2,46 %/mes bajando contra -0,79 % subiendo. Y es contemporaneo: mide el MISMO mes.
// Mirando al siguiente, el |rho| medio cae de 0,312 a 0,098 — un 69 %. Publicar el primero sin
// el segundo convierte una explicacion correcta en una señal que no existe.
{
  const t = lecturaTipoReal(-0.15);
  ok(/2\.46|2,46/.test(t), "la frase cita el retorno con el tipo real bajando");
  ok(/CONTEMPOR|contempor/i.test(t), "y declara que es contemporaneo");
  ok(/-0\.078|-0,078/.test(t), "y publica el rho PREDICTIVO al lado");
  ok(/no anticipa/i.test(t), "y dice explicitamente que no anticipa nada");
  ok(/ha bajado/.test(t), "y con un delta negativo dice que ha bajado");
  ok(/ha subido/.test(lecturaTipoReal(0.15)), "y al reves");
  ok(!/comprar|vender|oportunidad|deberia/i.test(t), "sin recomendar nada");
  ok(lecturaTipoReal(null).length > 50, "sin delta se publica igual el contexto");

  // La constante refleja que el poder predictivo se derrumba.
  ok(SENSIBILIDAD_REAL.rhoMedioPredictivo < SENSIBILIDAD_REAL.rhoMedioContemporaneo / 2,
     "la constante guarda que el predictivo es menos de la mitad del contemporaneo");
  ok(Math.abs(SENSIBILIDAD_REAL.oro.contemporaneo) > Math.abs(SENSIBILIDAD_REAL.sp500.contemporaneo) * 2,
     "y que la relacion es MUCHO mas fuerte en el oro que en las acciones");
  ok(Math.abs(SENSIBILIDAD_REAL.bitcoin.contemporaneo) < Math.abs(SENSIBILIDAD_REAL.oro.contemporaneo) / 2,
     "y que Bitcoin, que el video 4 mete en el mismo saco, esta MUY por debajo del oro");
  ok(SENSIBILIDAD_REAL.bitcoin.meses < 120, "con una muestra corta, ademas: su predictivo es ruido");
}

console.log(pass && !fail ? `\n✓ tipos: ${pass} passed, 0 failed\n` : `\n✖ tipos: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
