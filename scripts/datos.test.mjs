// ─────────────────────────────────────────────────────────────────────────────
// GUARDIÁN DE LA CAPA DE DATOS
//
// Los cinco defectos que se encontraron el 2026-08-23/24 vivieron MESES sin que nada fallara.
// Ninguno rompía: todos devolvían un número creíble. Este fichero existe para que no vuelvan,
// y está pensado para correr en CI, donde NO hay caché de EDGAR (2,2 GB, fuera de git).
//
// Dos partes, porque protegen de cosas distintas:
//
//   A · SOBRE LOS ARTEFACTOS VERSIONADOS, sin red. Caza el commit que degrada la extracción:
//       si la cobertura de una métrica se desploma o aparecen valores imposibles, salta aquí
//       antes de que nadie publique nada encima.
//
//   B · HUMO CONTRA LA SEC DE VERDAD, seis nombres. Caza lo que un artefacto congelado no
//       puede ver: que la SEC cambie un formato, o que un arreglo funcione en la caché vieja
//       y no contra los datos de hoy. Cada nombre está elegido porque reproduce UNO de los
//       cinco defectos; si la SEC no responde, se avisa y se salta en vez de romper el build.
//
//   node --experimental-strip-types --no-warnings scripts/datos.test.mjs [--sin-red]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(RAIZ, "research", "out");
const SIN_RED = process.argv.includes("--sin-red");

let pass = 0, fail = 0, avisos = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✖ ${msg}`); } };
const aviso = (msg) => { avisos++; console.warn(`  ⚠ ${msg}`); };
const leer = (f) => { const p = join(OUT, f); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };

// ══ A · LOS ARTEFACTOS VERSIONADOS ════════════════════════════════════════════════════════
console.log("\n  A · artefactos versionados (sin red)\n");

{
  const j = leer("sanidad_metricas.json");
  if (!j) aviso("falta sanidad_metricas.json — regenéralo con research/sanidad_metricas.mjs");
  else {
    // El umbral NO es cero a propósito. Las anomalías que quedan son reales: GoDaddy, Gartner
    // y Mettler-Toledo tienen patrimonio casi nulo por recompras, así que un ROE de cuatro
    // cifras es aritmética correcta. Un guardián que exigiera cero obligaría a maquillarlas.
    ok(j.totalAnomalias <= 8, `valores imposibles: ${j.totalAnomalias} (tolerancia 8) — mira research/out/sanidad_metricas.json`);
    ok(j.filas >= 400, `el barrido cubre ${j.filas} nombres (mínimo 400)`);

    // Suelos de cobertura. Cada uno se rompió de verdad en algún momento de la auditoría:
    // `netDebtEbitda` cuando la deuda ausente se escribía como cero, `grossProfitability`
    // cuando el margen bruto venía de 2009, `roic` cuando el capital invertido sólo contaba
    // el patrimonio. Una caída por debajo de esto significa que algo dejó de extraerse.
    const SUELO = { roa: 0.95, netMargin: 0.95, revenueGrowth: 0.95, pe: 0.80,
                    grossProfitability: 0.50, roic: 0.65, netDebtEbitda: 0.55, operatingMargin: 0.65 };
    for (const [k, min] of Object.entries(SUELO)) {
      const n = j.cobertura?.[k];
      if (n == null) { aviso(`el artefacto no trae cobertura de ${k}`); continue; }
      ok(n / j.filas >= min, `cobertura de ${k}: ${(100 * n / j.filas).toFixed(0)} % (suelo ${(100 * min).toFixed(0)} %)`);
    }
  }
}

{
  const j = leer("articulacion_lab.json");
  if (!j) aviso("falta articulacion_lab.json");
  else {
    // La partida doble no admite ruido: si el balance baja del 90 %, o los datos empeoraron o
    // la comprobación se planteó mal — que ya pasó cuatro veces.
    const SUELO = { balance: 90, caja: 90, patrimonio: 85, margen: 90 };
    for (const [k, min] of Object.entries(SUELO)) {
      const v = j.identidades?.[k];
      if (!v) { aviso(`el artefacto no trae la identidad ${k}`); continue; }
      ok(v.pctPasan >= min, `identidad "${k}": ${v.pctPasan} % cuadra (suelo ${min} %)`);
    }
    ok((j.confianza?.baja ?? 999) <= 40, `nombres con confianza baja: ${j.confianza?.baja} (tolerancia 40)`);
  }
}

{
  const j = leer("desfase_periodos.json");
  if (!j) aviso("falta desfase_periodos.json");
  else {
    // El defecto original: magnitudes de ejercicios distintos comparadas entre sí. Amazon
    // usaba un margen bruto de 2009 contra un activo de 2026. NINGÚN par puede volver a tener
    // casos por encima de tres años.
    for (const [par, v] of Object.entries(j.parejas ?? {})) {
      const lejanos = v.reparto?.[">3 años"] ?? 0;
      ok(lejanos === 0, `"${par}": ${lejanos} nombres con más de 3 años de desfase (el defecto de Amazon)`);
    }
    // Y el que alimenta los devengos de Sloan tiene que estar perfecto: resultado y flujo del
    // mismo cierre o la resta no es un devengo.
    const nio = j.parejas?.["ni|ocf"];
    if (nio) ok(nio.pctMismoCierre >= 95, `resultado ↔ flujo de explotación: ${nio.pctMismoCierre} % al mismo cierre (suelo 95 %)`);
  }
}

// ══ B · HUMO CONTRA LA SEC ════════════════════════════════════════════════════════════════
if (SIN_RED) {
  console.log("\n  B · humo contra la SEC — SALTADO (--sin-red)\n");
} else {
  console.log("\n  B · humo contra la SEC (seis nombres, uno por defecto)\n");
  const { tickerToCik, fundamentalsAsOf } = await import("../research/edgar.mjs");

  /** Cada caso reproduce UNO de los defectos encontrados. El comentario dice cuál. */
  const CASOS = [
    { t: "AAPL", cik: "0000320193", que: "TTM de doce meses seguidos (sumaba 4 trimestres sueltos)",
      comprueba: (f) => f.revTTM > 3e11 && f.ocfTTM > 5e10 && f.ocfTTM < 2.5e11 },
    { t: "JPM", cik: "0000019617", que: "flujo de explotación creíble (salía en −729 B)",
      comprueba: (f) => f.ocfTTM != null && Math.abs(f.ocfTTM) < 5e11 },
    { t: "AMZN", cik: "0001018724", que: "margen bruto del ejercicio en curso (usaba el de 2009)",
      comprueba: (f) => f.gpTTM > 0 && f.revTTM > 0 && f.gpTTM / f.revTTM > 0.25 && f.gpTTM / f.revTTM < 0.85 },
    { t: "CVS", cik: "0000064803", que: "la deuda no es cero por no encontrar el tag",
      comprueba: (f) => f.debt != null && f.debt > 1e10 },
    { t: "ESS", cik: "0000920522", que: "un REIT declara sus ingresos TOTALES, no una rebanada",
      comprueba: (f) => f.revTTM > 1e9 },
    { t: "SAP", cik: "0001000184", que: "una extranjera se lee en IFRS y en su moneda",
      comprueba: (f) => f.currency === "EUR" && f.revTTM > 1e10 && f.precioComparable === false },
  ];

  let red = true;
  for (const c of CASOS) {
    let f = null;
    try { f = await fundamentalsAsOf(c.cik, new Date().toISOString().slice(0, 10)); }
    catch { red = false; break; }
    if (!f) { aviso(`${c.t}: sin fundamentales (¿SEC no responde?) — se salta`); continue; }
    ok(c.comprueba(f), `${c.t} · ${c.que}`);
    // Y una invariante que vale para todos: si hay TTM, su cierre tiene que ser reciente.
    if (f.periodos?.rev) {
      const dias = Math.round((Date.now() - Date.parse(f.periodos.rev)) / 86400000);
      ok(dias < 500, `${c.t} · el cierre de ingresos (${f.periodos.rev}) tiene ${dias} días — más de 500 es un dato muerto`);
    }
  }
  if (!red) aviso("la SEC no responde: la parte B se salta entera en vez de romper el build");

  // El mapa de la SEC también resuelve por ticker, y es lo que usa producción.
  try {
    const cik = await tickerToCik("AAPL");
    ok(cik === "0000320193", `tickerToCik("AAPL") = ${cik}`);
  } catch { aviso("tickerToCik no pudo consultarse"); }
}

console.log(pass && !fail ? `\n✓ datos: ${pass} passed, 0 failed${avisos ? `, ${avisos} avisos` : ""}\n`
                          : `\n✖ datos: ${pass} passed, ${fail} failed${avisos ? `, ${avisos} avisos` : ""}\n`);
process.exit(fail ? 1 : 0);
