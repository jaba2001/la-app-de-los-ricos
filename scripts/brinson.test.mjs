// ─────────────────────────────────────────────────────────────────────────────
// LA ATRIBUCIÓN DE BRINSON
//
// El caso central es el EJEMPLO RESUELTO del temario (Gestión de Activos y Carteras, ejemplo 8),
// con sus números exactos. Si la implementación no lo reproduce, no es Brinson: es otra cosa con
// el mismo nombre.
//
//   node --experimental-strip-types --no-warnings scripts/brinson.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { atribuir, encadenar } from "../lib/brinson.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };
const cerca = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m} — esperado ${b}, salió ${a.toFixed(4)}`);

// ── EL EJEMPLO DEL TEMARIO, con sus cifras ───────────────────────────────────────────────
//              CARTERA        REFERENCIA
//           peso   rent     peso   rent
// Energía    10 %   18 %     30 %   15 %
// Financ.    30 %   25 %     10 %   20 %
// Consumo    15 %   20 %     35 %   30 %
// Tecnología 45 %    5 %     25 %    5 %
//
// Retorno cartera 14,55 % · referencia 18,25 % · diferencia −3,70 %
// Contribución por estrategia −4 % · por selección +0,3 %
{
  const a = atribuir([
    { categoria: "Energia",     pesoCartera: 0.10, pesoReferencia: 0.30, retornoCartera: 18, retornoReferencia: 15 },
    { categoria: "Financieras", pesoCartera: 0.30, pesoReferencia: 0.10, retornoCartera: 25, retornoReferencia: 20 },
    { categoria: "Consumo",     pesoCartera: 0.15, pesoReferencia: 0.35, retornoCartera: 20, retornoReferencia: 30 },
    { categoria: "Tecnologia",  pesoCartera: 0.45, pesoReferencia: 0.25, retornoCartera: 5,  retornoReferencia: 5 },
  ]);
  cerca(a.retornoCartera, 14.55, 0.01, "retorno de la cartera del ejemplo");
  cerca(a.retornoReferencia, 18.25, 0.01, "retorno de la referencia");
  cerca(a.retornoActivo, -3.70, 0.01, "diferencia a explicar");
  cerca(a.totalAsignacion, -4.00, 0.01, "contribucion por ESTRATEGIA (asignacion) del temario");
  cerca(a.totalSeleccion, 0.30, 0.01, "contribucion por SELECCION del temario");
  ok(a.cuadra, `las dos contribuciones suman el retorno activo (residuo ${a.residuo.toExponential(2)})`);

  // Y fila a fila, como el cuadro del temario.
  const f = Object.fromEntries(a.filas.map((x) => [x.categoria, x]));
  cerca(f.Energia.asignacion, 0.65, 0.01, "Energia: (10-30) x (15-18,25) = 0,65");
  cerca(f.Financieras.asignacion, 0.35, 0.01, "Financieras: (30-10) x (20-18,25) = 0,35");
  cerca(f.Consumo.asignacion, -2.35, 0.01, "Consumo: (15-35) x (30-18,25) = -2,35");
  cerca(f.Tecnologia.asignacion, -2.65, 0.01, "Tecnologia: (45-25) x (5-18,25) = -2,65");
  cerca(f.Energia.seleccion, 0.30, 0.01, "Energia seleccion: (18-15) x 10 = 0,3");
  cerca(f.Tecnologia.seleccion, 0, 0.01, "Tecnologia rinde igual que su referencia: seleccion 0");
}

// ── El cuadre es la propiedad que lo hace publicable ─────────────────────────────────────
{
  let s = 99;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  let fallos = 0;
  for (let it = 0; it < 200; it++) {
    const n = 3 + Math.floor(rnd() * 5);
    const wp = Array.from({ length: n }, () => rnd()), wb = Array.from({ length: n }, () => rnd());
    const sp = wp.reduce((x, y) => x + y, 0), sb = wb.reduce((x, y) => x + y, 0);
    const e = Array.from({ length: n }, (_, i) => ({
      categoria: "c" + i, pesoCartera: wp[i] / sp, pesoReferencia: wb[i] / sb,
      retornoCartera: (rnd() - 0.5) * 40, retornoReferencia: (rnd() - 0.5) * 40,
    }));
    if (!atribuir(e, 1e-9).cuadra) fallos++;
  }
  ok(fallos === 0, `cuadra en 200 casos aleatorios (fallaron ${fallos})`);
}

// ── No tener algo QUE LA REFERENCIA SÍ TIENE es una apuesta ──────────────────────────────
// Es el caso de Scora Picks con las megacapitalizaciones, y el que no se puede tratar como cero.
{
  const a = atribuir([
    { categoria: "tengo",   pesoCartera: 1.0, pesoReferencia: 0.5, retornoCartera: 10, retornoReferencia: 10 },
    { categoria: "notengo", pesoCartera: 0.0, pesoReferencia: 0.5, retornoCartera: null, retornoReferencia: 30 },
  ]);
  ok(a.filas[1].seleccion === 0, "no se puede seleccionar dentro de lo que no se tiene: seleccion 0");
  ok(a.filas[1].asignacion < 0, `pero NO tenerlo mientras sube es una apuesta perdedora (${a.filas[1].asignacion.toFixed(2)})`);
  ok(a.cuadra, "y aun asi cuadra");
  cerca(a.retornoActivo, -10, 0.01, "el coste de no tenerlo: 10 - 20 = -10 pp");
}

// ── Casos degenerados ────────────────────────────────────────────────────────────────────
{
  const a = atribuir([{ categoria: "unica", pesoCartera: 1, pesoReferencia: 1, retornoCartera: 5, retornoReferencia: 5 }]);
  cerca(a.retornoActivo, 0, 1e-12, "cartera identica a la referencia: retorno activo 0");
  cerca(a.totalAsignacion, 0, 1e-12, "sin asignacion");
  cerca(a.totalSeleccion, 0, 1e-12, "sin seleccion");
  ok(atribuir([]).cuadra, "una lista vacia no revienta");
}

// ── Encadenar periodos ───────────────────────────────────────────────────────────────────
{
  const p = [];
  for (let i = 0; i < 12; i++) {
    p.push(atribuir([
      { categoria: "a", pesoCartera: 0.7, pesoReferencia: 0.6, retornoCartera: 1 + i * 0.1, retornoReferencia: 1 },
      { categoria: "b", pesoCartera: 0.3, pesoReferencia: 0.4, retornoCartera: 0.5, retornoReferencia: 0.5 },
    ]));
  }
  const e = encadenar(p);
  ok(e.todosCuadran, "los 12 periodos cuadran individualmente");
  cerca(e.asignacion + e.seleccion, e.retornoActivoSumado, 1e-9, "suma de contribuciones = suma de retornos activos");
  // ⚠️ El compuesto NO es la suma. Esa diferencia se REPORTA, no se reparte en silencio.
  ok(Math.abs(e.residuoComposicion) > 0, `el efecto de composicion existe y se reporta (${e.residuoComposicion.toFixed(4)} pp)`);
  ok(e.periodos === 12, "y se dice cuantos periodos se encadenaron");
}

console.log(pass && !fail ? `\n✓ brinson: ${pass} passed, 0 failed\n` : `\n✖ brinson: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
