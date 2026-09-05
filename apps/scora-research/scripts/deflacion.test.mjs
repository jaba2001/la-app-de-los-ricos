// ─────────────────────────────────────────────────────────────────────────────
// EL SHARPE DEFLACTADO — Bailey y López de Prado
//
// Lo que fija este fichero: que la deflación CASTIGUE al aumentar los ensayos, que la normal
// acumulada y su inversa sean correctas, y que la corrección por colas gruesas vaya en la
// dirección que debe. El repo llevaba deflactando a ojo contra √(2·ln N); esto lo hace bien.
//
//   node --experimental-strip-types --no-warnings scripts/deflacion.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { normalCdf, normalInv, sharpeDeflactado } from "../lib/deflacion.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };
const cerca = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m} — esperado ${b}, salió ${a}`);

// ── La normal, contra valores de tabla ───────────────────────────────────────────────────
cerca(normalCdf(0), 0.5, 1e-6, "Phi(0) = 0,5");
cerca(normalCdf(1.96), 0.975, 1e-4, "Phi(1,96) = 0,975");
cerca(normalCdf(-1.96), 0.025, 1e-4, "Phi(-1,96) = 0,025");
cerca(normalCdf(2.576), 0.995, 1e-4, "Phi(2,576) = 0,995");
cerca(normalInv(0.975), 1.96, 1e-3, "Phi-1(0,975) = 1,96");
cerca(normalInv(0.5), 0, 1e-6, "Phi-1(0,5) = 0");
cerca(normalInv(0.025), -1.96, 1e-3, "Phi-1(0,025) = -1,96");
// Y que sean inversas de verdad, no dos aproximaciones que casi coinciden.
for (const p of [0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) cerca(normalCdf(normalInv(p)), p, 1e-4, `Phi(Phi-1(${p})) = ${p}`);

// ── LO QUE MAS IMPORTA: mas ensayos, mas castigo ─────────────────────────────────────────
{
  const sm = 0.25, T = 236;
  const d1 = sharpeDeflactado(sm, T, 1), d50 = sharpeDeflactado(sm, T, 50), d1000 = sharpeDeflactado(sm, T, 1000);
  ok(d1.dsr > d50.dsr && d50.dsr > d1000.dsr, `mas ensayos bajan la probabilidad (${d1.dsr.toFixed(3)} > ${d50.dsr.toFixed(3)} > ${d1000.dsr.toFixed(3)})`);
  ok(d1.sharpeUmbral < d50.sharpeUmbral && d50.sharpeUmbral < d1000.sharpeUmbral, "y suben el umbral que hay que superar");
  ok(d1.supera, "con un solo ensayo, un Sharpe mensual de 0,25 sobre 236 meses supera el 95 %");
  ok(!d1000.supera, "con mil ensayos, no");
}

// Mas observaciones ayudan: es lo unico que compensa haber buscado mucho.
{
  const a = sharpeDeflactado(0.2, 120, 344), b = sharpeDeflactado(0.2, 480, 344);
  ok(b.dsr > a.dsr, `con el cuadruple de meses la probabilidad sube (${a.dsr.toFixed(3)} -> ${b.dsr.toFixed(3)})`);
}

// Un Sharpe mayor da mas probabilidad, con todo lo demas igual.
{
  const a = sharpeDeflactado(0.1, 236, 344), b = sharpeDeflactado(0.35, 236, 344);
  ok(b.dsr > a.dsr, "un Sharpe mayor da mas probabilidad");
}

// ── La correccion por la forma de la distribucion ────────────────────────────────────────
// ⚠️ Colas MAS gruesas => el Sharpe es MENOS fiable => la probabilidad tiene que BAJAR. Si
// subiera, el signo de la correccion estaria invertido y la deflacion premiaria el riesgo de cola.
{
  const normal = sharpeDeflactado(0.25, 236, 344, 0, 3);
  const colas = sharpeDeflactado(0.25, 236, 344, 0, 6);
  ok(colas.dsr < normal.dsr, `colas gruesas bajan la probabilidad (${normal.dsr.toFixed(3)} -> ${colas.dsr.toFixed(3)})`);
  // Asimetria NEGATIVA (cola izquierda larga) tambien tiene que penalizar.
  const izq = sharpeDeflactado(0.25, 236, 344, -0.8, 3);
  const der = sharpeDeflactado(0.25, 236, 344, 0.8, 3);
  ok(izq.dsr < der.dsr, `la asimetria negativa penaliza frente a la positiva (${izq.dsr.toFixed(3)} < ${der.dsr.toFixed(3)})`);
}

// ── Casos degenerados: nada de NaN ───────────────────────────────────────────────────────
{
  for (const d of [sharpeDeflactado(0, 236, 344), sharpeDeflactado(0.25, 2, 344),
                   sharpeDeflactado(-0.1, 236, 344), sharpeDeflactado(0.25, 236, 0)]) {
    ok(Number.isFinite(d.dsr) && d.dsr >= 0 && d.dsr <= 1, `DSR siempre entre 0 y 1 (salio ${d.dsr})`);
  }
  ok(sharpeDeflactado(0.25, 236, 1).ensayos === 2, "con 0 o 1 ensayos se usa el minimo de 2, no se divide por cero");
}

// ── El caso real del allocator, fijado ───────────────────────────────────────────────────
// Sharpe mensual 0,2503 sobre 236 meses, asimetria 0,065, curtosis total 5,516.
{
  const d = sharpeDeflactado(0.2503, 236, 344, 0.065, 5.516);
  ok(!d.supera, `el allocator NO supera la deflacion con 344 ensayos (DSR ${(100*d.dsr).toFixed(1)} %)`);
  ok(d.dsr > 0.75 && d.dsr < 0.9, `y queda en la banda del 75-90 % (${(100*d.dsr).toFixed(1)} %) — cerca, pero no`);
  const uno = sharpeDeflactado(0.2503, 236, 1, 0.065, 5.516);
  ok(uno.supera, "con un solo ensayo si lo superaria: la diferencia la hace haber buscado");
}

console.log(pass && !fail ? `\n✓ deflacion: ${pass} passed, 0 failed\n` : `\n✖ deflacion: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
