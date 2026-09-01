// ─────────────────────────────────────────────────────────────────────────────
// ¿CUÁNTAS DECISIONES SE DECIDEN EN UN FILO MÁS FINO QUE LA MEDIDA?
//
// ⚠️ EXISTE POR UNA OBSERVACIÓN DEL 2026-09-01, no por un fallo.
//
// Dos corridas del backtest con las MISMAS entradas —sólo cambió la foto de miembros, y el
// universo pasó de 510 a 509 nombres— dieron +212,1 % y +216,6 %. Al mirar por qué, apareció
// esto: el 2023-03-15 ACN puntuaba 0,8094 y BKNG 0,8088. Los separan SEIS DIEZMILÉSIMAS,
// cuando la resolución de un percentil sobre 371 nombres es 1/371 = 0,0027. O sea que los
// separa menos de lo que vale UN nombre del universo, y quitar uno cualquiera los intercambia.
//
// El desempate del motor (`lib/picks.ts`) es determinista —percentil, y a igualdad alfabético—
// y está bien puesto. El problema es que NUNCA LLEGA A ACTUAR: formalmente no hay empate.
//
// Y las consecuencias no se quedan ahí, porque la estrategia es dependiente del camino: al
// entrar ACN en vez de BKNG cambió el cupo de las fechas siguientes, y META pasó de venderse
// en 2023-10-16 con +157,5 % a no venderse nunca y acabar en +451 %.
//
// Esto NO dice que el resultado esté mal. Dice cuánta de la cifra publicada descansa en
// diferencias que la propia medida no resuelve — y eso hay que saberlo antes de citar un
// decimal.
//
//   node --experimental-strip-types --no-warnings research/filo_decision.mjs [--long]
//
// No toca precios ni red: sólo el panel ya calculado. Es barato.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { decide } from "../lib/picks.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const LONG = process.argv.includes("--long");
const VENTANA = LONG ? "2011-2018" : "2019-2026";

const crudo = JSON.parse(readFileSync(join(AQUI, "out", `picks_signal_panel_${VENTANA}.json`), "utf8"));
const PANEL = crudo.panel ?? crudo.fechas ?? crudo;
const fechas = Object.keys(PANEL).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();

// Mismos ajustes que producción (§3-§6). Si cambian allí, esto deja de medir lo mismo.
const ENTRY = 0.80, EXIT = 0.50, TOP_N = 40, COMPRAS = 2, PERSISTENCIA = 60, CUARENTENA = 12;

let state = { holdings: [], quarantineUntil: {}, belowExitCount: {} };
const filos = [];
let decisionesConCompra = 0;

for (let i = 0; i < fechas.length; i++) {
  const fecha = fechas[i];
  const sig = PANEL[fecha];
  const history = [];
  for (let j = Math.max(0, i - 8); j < i; j++) history.push({ date: fechas[j], signal: PANEL[fechas[j]] });

  const d = decide({
    date: fecha, signal: sig, history, state, disqualified: [],
    overrides: { entryPctl: ENTRY, exitPctl: EXIT, targetPositions: TOP_N, buysPerDate: COMPRAS, persistenceDays: PERSISTENCIA, quarantineMonths: CUARENTENA },
  });

  if (d.buys.length && d.eligibleNotBought.length) {
    decisionesConCompra++;
    // El filo: cuánto separa al último que ENTRA del primero que se queda fuera.
    const ultimoDentro = d.buys[d.buys.length - 1];
    const primeroFuera = d.eligibleNotBought[0];
    const hueco = ultimoDentro.pctl - primeroFuera.pctl;
    const n = Object.keys(sig).length;
    filos.push({ fecha, dentro: ultimoDentro.ticker, fuera: primeroFuera.ticker, hueco, resolucion: 1 / n, n });
  }
  state = d.nextState;
}

const resuelto = filos.filter((f) => f.hueco >= f.resolucion);
const filo = filos.filter((f) => f.hueco < f.resolucion);
const empate = filos.filter((f) => f.hueco === 0);

console.log(`\n  EL FILO DE LA DECISIÓN · ${VENTANA} · ${fechas.length} fechas\n`);
console.log(`  decisiones con compra y con alguien esperando: ${decisionesConCompra}`);
console.log(`  · el hueco SUPERA la resolución del percentil: ${resuelto.length}  (${(100 * resuelto.length / filos.length).toFixed(0)} %)`);
console.log(`  · el hueco es MENOR que la resolución:         ${filo.length}  (${(100 * filo.length / filos.length).toFixed(0)} %)  ← lo decide algo que la medida no distingue`);
console.log(`  · empate exacto (ahí sí actúa el alfabético):  ${empate.length}`);

if (filo.length) {
  console.log(`\n  Las 15 más finas:\n`);
  for (const f of [...filo].sort((a, b) => a.hueco - b.hueco).slice(0, 15)) {
    console.log(`    ${f.fecha}  entra ${f.dentro.padEnd(6)} y se queda ${f.fuera.padEnd(6)}  hueco ${f.hueco.toExponential(2).padStart(9)}   resolución ${f.resolucion.toExponential(2)}  (${f.n} nombres)`);
  }
}

const media = filos.reduce((s, f) => s + f.hueco / f.resolucion, 0) / (filos.length || 1);
console.log(`\n  Hueco medio, medido en unidades de resolución: ${media.toFixed(2)}`);
console.log(`  (por debajo de 1 significa que la decisión típica se toma dentro del ruido de la medida)\n`);
