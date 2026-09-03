// ─────────────────────────────────────────────────────────────────────────────
// LA TASA LIBRE DE RIESGO, DE VERDAD
//
// ⚠️ **HASTA HOY VALÍA CERO.** `riskMetrics.ts` tiene `rfAnnual = 0` por defecto y ningún
// script le pasaba otra cosa, así que **todos los Sharpe y Sortino publicados asumen que el
// efectivo no renta nada**. Sobre 2007-2026 eso no es una simplificación menor: las letras
// pasaron del 5 % (2007) al 0 % (2009-2015 y 2020-2021) y de vuelta al 5 % (2023-2024).
//
// Medido: con Rf = 0 el Sharpe de la estrategia sale **1,01**; con un 1,5 % realista, **0,87**.
// El ORDEN se conserva (estrategia > 60/40 > SPY en los dos casos) pero el nivel absoluto que
// se anuncia, no. Y es un número que está en la landing.
//
// Serie: **TB3MS** — letras del Tesoro a 3 meses, mercado secundario, MENSUAL, desde 1934. Se
// elige mensual y no diaria (DTB3) porque el backtest reequilibra mensualmente y así no hay que
// decidir qué día del mes tomar.
//
//   node --experimental-strip-types --no-warnings research/tasaLibre.mjs        (valida contra BIL)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const FRED = process.env.FRED_KEY || "89002273b3b4289f0869a5e5318b7277";
const DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache", "fredfull");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

let cache = null;

/** Serie mensual `{ "AAAA-MM": tasa_anual_% }` de letras a 3 meses. */
export async function tasasMensuales() {
  if (cache) return cache;
  const path = join(DIR, "TB3MS.json");
  let obs = null;
  if (existsSync(path)) { try { obs = JSON.parse(readFileSync(path, "utf8")); } catch { obs = null; } }
  if (!obs?.length) {
    const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=TB3MS&api_key=${FRED}&file_type=json`);
    if (!r.ok) throw new Error(`FRED TB3MS: HTTP ${r.status}`);
    const j = await r.json();
    obs = (j?.observations ?? []).filter((o) => o.value !== "." && o.value !== "").map((o) => ({ date: o.date, v: parseFloat(o.value) }));
    if (!obs.length) throw new Error("FRED TB3MS: sin observaciones");
    writeFileSync(path, JSON.stringify(obs));
  }
  cache = Object.fromEntries(obs.map((o) => [o.date.slice(0, 7), o.v]));
  return cache;
}

/**
 * Retorno MENSUAL en % de la caja para cada fecha de una lista.
 *
 * La serie de FRED da una tasa ANUALIZADA; el retorno de un mes es esa tasa entre doce. Es la
 * aproximación estándar para letras y difiere del compuesto exacto en menos de un punto básico
 * al mes a estos niveles.
 *
 * ⚠️ **Un mes sin dato NO se rellena con cero**: se devuelve `null` y quien llame decide. Un cero
 * aquí diría «ese mes el efectivo no rentó», que es exactamente el tipo de silencio que ya nos
 * costó la crisis de 2008 en la serie de precios.
 */
export async function rfMensual(fechas) {
  const t = await tasasMensuales();
  return fechas.map((f) => {
    const v = t[f.slice(0, 7)];
    return v == null ? null : v / 12;
  });
}

/** Tasa anual media (%) del periodo — la que se pasa a `riskMetrics` cuando basta una constante. */
export async function rfAnualMedia(fechas) {
  const m = await rfMensual(fechas);
  const v = m.filter((x) => x != null);
  return v.length ? (v.reduce((s, x) => s + x, 0) / v.length) * 12 : 0;
}

// ── Validación contra BIL ────────────────────────────────────────────────────────────────
// Si esta serie es la tasa libre de riesgo, el ETF de letras tiene que rendir prácticamente lo
// mismo. Es la única comprobación que distingue «he traído la serie correcta» de «he traído una
// serie»: dos fuentes independientes que tienen que coincidir.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("tasaLibre.mjs")) {
  const { serieCompleta } = await import("./prices.mjs");
  const addM = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
  const fechas = []; for (let d = "2007-06-01"; d <= "2026-06-01"; d = addM(d, 1)) fechas.push(d);
  const rf = await rfMensual(fechas);
  const bil = await serieCompleta("BIL");
  const px = new Map(bil.map((r) => [r.date, r.adj]));
  const dias = bil.map((r) => r.date);
  const cerca = (f) => { let mejor = null; for (const d of dias) { if (d <= f) mejor = d; else break; } return mejor; };

  const pares = [];
  for (let i = 0; i < fechas.length - 1; i++) {
    const a = cerca(fechas[i]), b = cerca(fechas[i + 1]);
    if (!a || !b || rf[i] == null) continue;
    const rBil = (px.get(b) / px.get(a) - 1) * 100;
    pares.push({ f: fechas[i], rf: rf[i], bil: rBil });
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const mRf = mean(pares.map((p) => p.rf)), mBil = mean(pares.map((p) => p.bil));
  const difAnual = (mRf - mBil) * 12;
  const corr = (() => {
    const x = pares.map((p) => p.rf), y = pares.map((p) => p.bil), mx = mean(x), my = mean(y);
    let c = 0, vx = 0, vy = 0;
    for (let i = 0; i < x.length; i++) { c += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; vy += (y[i] - my) ** 2; }
    return c / Math.sqrt(vx * vy);
  })();

  console.log(`\n  TASA LIBRE DE RIESGO · TB3MS contra el retorno realizado de BIL (${pares.length} meses)`);
  console.log(`    media anualizada TB3MS : ${(mRf * 12).toFixed(2)} %`);
  console.log(`    media anualizada BIL   : ${(mBil * 12).toFixed(2)} %`);
  console.log(`    diferencia             : ${difAnual.toFixed(2)} pp/año  (el ETF cobra ~0,14 % de comisión)`);
  console.log(`    correlación            : ${corr.toFixed(3)}`);
  const ok = corr > 0.9 && Math.abs(difAnual) < 0.5;
  console.log(`    ${ok ? "✓ las dos fuentes coinciden: la serie es la correcta" : "⛔ NO coinciden — no usar esta serie"}\n`);
  if (!ok) process.exit(1);
}
