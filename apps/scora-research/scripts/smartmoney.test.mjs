// ─────────────────────────────────────────────────────────────────────────────
// GUARDA DEL SCORE DE DINERO INTELIGENTE
//
// POR QUÉ EXISTE. El score anunciaba «Insider · 13-F · Congress» y entregaba una sola fuente:
//
//   · el **13-F nunca puntuó** — la función recibe insiders y Congreso, no carteras. Se muestra
//     en el panel como contexto, que es donde sí vale: lo que se lee hoy es lo que había hace
//     entre 45 y 135 días, así que para «qué hace el dinero inteligente AHORA» no encaja.
//   · el **Congreso valía ±35 de 100** y llevaba en CERO desde que los volcados públicos del
//     STOCK Act dejaron de serlo. Cero permanente no es «no hay actividad», y presentarlo así
//     es afirmar algo sobre datos que no se tienen. Retirado el 2026-09-04.
//
// ⚠️ Y LO QUE ESTA GUARDA PROTEGE SOBRE TODO: **que nadie reescale el score a 100**. Es la
// tentación evidente —los insiders solos llegan a 85— y sería hacer que una señal MÁS DÉBIL
// puntuara como la combinada. Los umbrales de etiqueta (±25) y convicción (±40) están fijados
// contra esta escala: reescalar movería acciones de «Neutral» a «Bullish» sin que hubiera
// cambiado ni un dato. Perdimos información y el alcance del score debe reflejarlo.
//
// CÓMO PRUEBA: EJECUTANDO la función con carteras construidas a mano, no leyendo el fuente.
// Sólo dos comprobaciones miran el texto, y son las del rótulo, que es texto por naturaleza.
//
//   node --experimental-strip-types --no-warnings scripts/smartmoney.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { computeSmartMoneySignal } from "../lib/smartMoney.ts";

let ok = 0, fallos = 0;
const comprobar = (que, cond, det = "") => {
  if (cond) { ok++; } else { fallos++; console.error(`  ✗ ${que}${det ? ` — ${det}` : ""}`); }
};

console.log("\n  GUARDA DEL SCORE DE DINERO INTELIGENTE\n");

// Filas mínimas que el módulo sabe leer. `transactionType` decide compra o venta.
// ⚠️ El campo de acciones es `change` (o `share`), NO `transactionShares`. Escribi el test con
// el nombre equivocado y las filas daban CERO acciones: el importe salia 0, su signo 0, y el
// techo aparecia como 75 en vez de 85. Lo cazo el propio aserto, que es para lo que estan.
const compraIns = (n) => ({ transactionType: "P-Purchase", name: n, change: 1000, transactionPrice: 10 });
const ventaIns = (n) => ({ transactionType: "S-Sale", name: n, change: -1000, transactionPrice: 10 });
const compraCon = () => ({ type: "purchase", amount: 50000, date: "2026-08-01" });
const ventaCon = () => ({ type: "sale", amount: 50000, date: "2026-08-01" });

// ── 1. Lo esencial: el Congreso ya NO mueve la nota ──────────────────────────────────────
{
  const soloCongresoCompra = computeSmartMoneySignal([], [compraCon(), compraCon(), compraCon()]);
  comprobar("con SOLO compras del Congreso, la nota es 0", soloCongresoCompra.netScore === 0, `salió ${soloCongresoCompra.netScore}`);

  const soloCongresoVenta = computeSmartMoneySignal([], [ventaCon(), ventaCon(), ventaCon()]);
  comprobar("con SOLO ventas del Congreso, la nota es 0", soloCongresoVenta.netScore === 0, `salió ${soloCongresoVenta.netScore}`);

  // Y lo que de verdad importa: añadir Congreso no debe cambiar una nota ya formada.
  const ins = [compraIns("A"), compraIns("B"), ventaIns("C")];
  const sin = computeSmartMoneySignal(ins, []);
  const conCompras = computeSmartMoneySignal(ins, [compraCon(), compraCon()]);
  const conVentas = computeSmartMoneySignal(ins, [ventaCon(), ventaCon()]);
  comprobar("añadir compras del Congreso NO mueve la nota", sin.netScore === conCompras.netScore, `${sin.netScore} vs ${conCompras.netScore}`);
  comprobar("añadir ventas del Congreso NO mueve la nota", sin.netScore === conVentas.netScore, `${sin.netScore} vs ${conVentas.netScore}`);
}

// ── 2. Los recuentos del Congreso SÍ se siguen devolviendo (el panel los muestra aparte) ──
{
  const s = computeSmartMoneySignal([], [compraCon(), compraCon(), ventaCon()]);
  comprobar("los recuentos del Congreso siguen disponibles", s.congress.buyCount === 2 && s.congress.sellCount === 1,
    `${s.congress.buyCount}B/${s.congress.sellCount}S`);
}

// ── 3. NO REESCALADO: el techo son 85, no 100 ────────────────────────────────────────────
{
  // Máximo teórico de la parte de insiders: 55 (todo compras) + 20 (racimo) + 10 (importe neto).
  const muchasCompras = ["A", "B", "C", "D", "E"].map(compraIns);
  const s = computeSmartMoneySignal(muchasCompras, []);
  comprobar("el máximo alcanzable es 85, no 100", s.netScore === 85, `salió ${s.netScore}`);
  comprobar("y no llega a 100 ni con el Congreso comprando", computeSmartMoneySignal(muchasCompras, [compraCon(), compraCon()]).netScore === 85);

  const muchasVentas = ["A", "B", "C", "D", "E"].map(ventaIns);
  const v = computeSmartMoneySignal(muchasVentas, []);
  comprobar("y por abajo el suelo es −65 (sin racimo, que sólo existe al comprar)", v.netScore === -65, `salió ${v.netScore}`);
}

// ── 4. El tamaño de muestra cuenta lo que PUNTÚA ─────────────────────────────────────────
{
  // Dos insiders y ocho del Congreso: si el Congreso contara, la convicción subiría sin motivo.
  const pocos = [compraIns("A"), compraIns("B")];
  const congreso = Array.from({ length: 8 }, compraCon);
  const a = computeSmartMoneySignal(pocos, []);
  const b = computeSmartMoneySignal(pocos, congreso);
  comprobar("el Congreso no infla la convicción", a.conviction === b.conviction, `${a.conviction} vs ${b.conviction}`);
}

// ── 5. El rótulo no promete lo que no puntúa ─────────────────────────────────────────────
{
  const UI = readFileSync(new URL("../components/stock/StockSmartMoney.tsx", import.meta.url), "utf8");
  const rotulo = UI.split(/\r?\n/).find((l) => l.includes('className="sr-hint"') && l.includes("Insider")) ?? "";
  comprobar("el rótulo existe", rotulo !== "");
  comprobar("y NO presenta 13-F y Congress como fuentes de la nota",
    !/Insider\s*·\s*13-F\s*·\s*Congress\s*·\s*free data/.test(rotulo), rotulo.trim().slice(0, 80));
  comprobar("el panel marca que el Congreso no puntúa", /no puntúa|fuente no disponible/.test(UI));
}

// ── CONTROL POSITIVO ─────────────────────────────────────────────────────────────────────
// Si el Congreso volviera a sumar, la primera comprobación tiene que caer. Se reconstruye la
// fórmula antigua para demostrar que la guarda distingue una cosa de la otra.
{
  const cBuy = 3, cSell = 0;
  const antiguoCongressRaw = ((cBuy - cSell) / (cBuy + cSell)) * 35;
  comprobar("CONTROL POSITIVO · la fórmula antigua SÍ daba 35 con sólo compras del Congreso", Math.round(antiguoCongressRaw) === 35);
  const hoy = computeSmartMoneySignal([], [compraCon(), compraCon(), compraCon()]).netScore;
  comprobar("CONTROL POSITIVO · y hoy da 0, que es la diferencia que esta guarda vigila", hoy === 0 && Math.round(antiguoCongressRaw) !== hoy);
}

console.log(`\n  ${ok} comprobaciones OK${fallos ? ` · ${fallos} FALLOS` : ""}\n`);
process.exit(fallos ? 1 : 0);
