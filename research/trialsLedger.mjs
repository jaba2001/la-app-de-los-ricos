// ─────────────────────────────────────────────────────────────────────────────
// LIBRO DE ENSAYOS (F0b) — PLAN_TEORIA_FINANCIERA_SCORA.md §3.3.
//
// El Sharpe deflactado (Bailey & López de Prado) descuenta el sesgo de haber probado
// muchas cosas: si pruebas M estrategias SIN edge y te quedas con la mejor, esa mejor
// tendrá un Sharpe claramente positivo por puro azar. El umbral SR0 crece con M.
//
// El problema: `portfolio_backtest.mjs` calcula M como `perConfig.length`, o sea los
// ensayos DE ESE SCRIPT EN ESA EJECUCIÓN (hoy: 3). Pero el M estadísticamente correcto es
// todo lo que el investigador ha evaluado sobre LOS MISMOS DATOS — y en research/ hay una
// docena de laboratorios que han barrido variantes sobre la misma historia 2007-2026.
// Solo hay una historia de mercados; cada pasada la gasta.
//
// Este módulo cuenta los ensayos que dejaron artefacto y escribe research/out/trials_ledger.json.
//
// ⚠️ ES UNA COTA INFERIOR, y hay que decirlo siempre: solo cuenta lo que dejó fichero.
// Las variantes exploradas y descartadas sin guardar, los reruns con parámetros distintos
// y las pruebas manuales no aparecen. El M real es MAYOR, así que el listón real es MÁS
// ALTO que el que sale de aquí — nunca más bajo.
//
// Uso:  node --experimental-strip-types --no-warnings research/trialsLedger.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const LEDGER = join(OUT, "trials_ledger.json");

// Allowlist por prefijo. NO se escanea el directorio entero a ciegas: kb_chunks.json pesa
// 63 MB y leerlo aquí sería absurdo. Cada entrada dice qué barrió ese laboratorio.
const LABS = [
  ["capture_lab", "Variantes de captura (beta alta) vs SPY"],
  ["allocator_lab", "Políticas de asignación del curso vs C3"],
  ["aggressive_lab", "Apalancamiento, coberturas cortas, long-vol, CPPI"],
  ["ls_lab", "Long/short por factor con puertas de correlación"],
  ["qgv_lab", "Combinaciones calidad/crecimiento/valor"],
  ["beat_index_lab", "Intentos de batir al índice"],
  ["multitimeframe_lab", "Momentum por horizonte y confluencia"],
  ["options_collar_lab", "Collars y overlays de opciones"],
  ["regime_sector_lab", "Rotación sectorial y de factores por régimen"],
  ["sector_tilt_validate", "Validación del tilt sectorial"],
  ["regime_factor_validate", "Validación de la rotación growth/value"],
  ["growth_metrics", "Perfiles del asignador por la vía de producción"],
  ["backtest_assets_summary", "Políticas multi-activo"],
  ["portfolio_backtest", "Barrido de N de la cartera de selección"],
  ["momentum_lab", "Señales de momentum (sesión 2026-08-17)"],
  ["momentum_audit", "Auditoría de momentum"],
  ["factor_dist", "Distribuciones de factores"],
  ["factor_lab", "Hipótesis de fricción: ¿la IC es mayor donde el arbitraje es caro?"],
  ["signals_ic", "IC por factor y régimen"],
  // ── Añadidos el 24-08-2026. Todo el trabajo de Scora Picks se había quedado FUERA del
  // recuento, y no es poco: la ablación de reglas son 10 variantes por ventana, el barrido de
  // calidad son 4 señales × 10 tamaños × 2 ventanas, y el veto forense otras tantas. Cada
  // ensayo no contado BAJA artificialmente el listón de significancia de todo lo demás, así
  // que omitirlos hacía el Sharpe deflactado más permisivo justo donde más se ha buscado.
  ["quality_lowvol_lab", "Señales de Picks: calidad, baja volatilidad y sus combinaciones"],
  ["pillar_dilution_lab", "Pilares del score solos y en pares"],
  ["health_scale_lab", "Escala y juego de métricas del pilar health"],
  ["picks_rules_backtest", "Ablación de las reglas de Scora Picks"],
  ["forense_lab", "Veto forense: devengos, Beneish y Piotroski"],
  ["lideres_lab", "¿Repiten los mejores del año al siguiente?"],
  // NO se cuentan `articulacion_lab`, `sanidad_metricas`, `desfase_periodos`,
  // `banca_cobertura` ni `forense_solapamiento`: no contrastan ninguna hipótesis sobre el
  // mercado. Son control de calidad del dato, y meterlos inflaría M sin motivo — que sería el
  // error simétrico al de omitir los de arriba.
];

/** Cuenta las variantes evaluadas en un artefacto. null = forma desconocida (se reporta). */
export function countTrials(json) {
  if (!json || typeof json !== "object") return null;
  // El propio script ya lo declara (portfolio_backtest).
  if (json.significance && Number.isFinite(json.significance.trials)) return json.significance.trials;
  const bag = json.results ?? json.report;
  if (Array.isArray(bag)) return bag.length;
  if (bag && typeof bag === "object") {
    // `quality_lowvol_lab` evalúa además cada señal en 10 tamaños de cartera, y cada tamaño
    // ES un ensayo: fue exactamente así como se descubrió que `TOP_N = 25` era el pico de la
    // ventana mirada. Contar sólo las señales escondería el barrido que hace peligrosa la
    // elección del parámetro.
    const barrido = json.sizeSweep && typeof json.sizeSweep === "object" ? Object.keys(json.sizeSweep).length : 0;
    return Object.keys(bag).length + barrido;
  }
  // picks_rules_backtest: cada variante de la ablación es un ensayo, y el barrido de umbrales
  // otro por punto. Se habían quedado sin contar los dos.
  if (json.ablacionReglas && typeof json.ablacionReglas === "object") {
    const abl = Object.keys(json.ablacionReglas).length;
    const sweep = json.barridoUmbrales && typeof json.barridoUmbrales === "object" ? Object.keys(json.barridoUmbrales).length : 0;
    return abl + sweep;
  }
  // pillar_dilution_lab: cada pilar y cada par evaluado.
  if (json["señales"] && typeof json["señales"] === "object") return Object.keys(json["señales"]).length;
  // forense_lab: tres hipótesis, cada una con su configuración de veto.
  if (json.HF1 && json.HF3) return 3;
  // lideres_lab: una hipótesis (¿repiten los líderes?), medida sobre N años.
  if (json.pruebaDeSignos) return 1;
  // regime_sector_lab: dos barridos independientes en el mismo fichero.
  if (json.regimeSectorExcess && json.regimeFactorExcess) {
    return Object.keys(json.regimeSectorExcess).length + Object.keys(json.regimeFactorExcess).length;
  }
  // signals_ic: un ensayo por (factor × régimen) evaluado.
  if (json.factorIC && typeof json.factorIC === "object") {
    return Object.values(json.factorIC).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
  }
  // backtest_assets_summary: cada clave-política con métricas es un ensayo.
  const policyKeys = Object.entries(json).filter(([, v]) => v && typeof v === "object" && "sharpe" in v);
  if (policyKeys.length) return policyKeys.length;
  // momentum_lab: cada cartera construida es una variante evaluada (SPY es el control,
  // no un ensayo, así que no cuenta).
  if (json.portfolios && typeof json.portfolios === "object") {
    return Object.keys(json.portfolios).filter((k) => k.toLowerCase() !== "spy").length;
  }
  // momentum_audit: cada bloque A1_…A9_ es una familia de contrastes sobre los mismos datos.
  const auditBlocks = Object.keys(json).filter((k) => /^A\d+_/.test(k));
  if (auditBlocks.length) return auditBlocks.length;
  // factor_dist: estadística DESCRIPTIVA (distribuciones por sector), no una búsqueda de
  // estrategias. No consume grados de libertad → 0 ensayos, pero contado (no "desconocido").
  if (json.dist && json.levels) return 0;
  return null;
}

/**
 * Cosecha los Sharpe ANUALES de las variantes de un artefacto.
 *
 * Por qué importa: SR0 = sqrt(var(SR)) · f(M). Aplicar un M grande sobre una varianza
 * estimada con 3 configuraciones casi gemelas (el barrido de N da Sharpe 0.99 tres veces)
 * deja SR0 en ~0 y la deflación no muerde. La dispersión honesta es la de TODO lo que se
 * probó: de −0.02 (long/short) a 1.02 (asignador). Esa es la que hay que meter en la fórmula.
 */
export function collectSharpes(json) {
  const out = [];
  const scan = (bag) => {
    if (!bag || typeof bag !== "object") return;
    for (const v of Object.values(bag)) {
      if (v && typeof v === "object" && Number.isFinite(v.sharpe)) out.push(v.sharpe);
    }
  };
  scan(json.results);
  scan(json.report);
  if (!out.length) scan(json); // artefactos con las políticas al nivel raíz
  return out;
}

export function buildLedger() {
  const files = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith(".json")) : [];
  const entries = [];
  const unknown = [];
  const allSharpes = [];

  for (const [prefix, note] of LABS) {
    // Cada fichero que empieza por el prefijo es una EJECUCIÓN distinta (ventanas
    // temporales alternativas incluidas): cada una es un barrido más sobre los datos.
    const matches = files.filter((f) => f === `${prefix}.json` || f.startsWith(`${prefix}_`));
    for (const f of matches) {
      if (f === "trials_ledger.json") continue;
      let json;
      try { json = JSON.parse(readFileSync(join(OUT, f), "utf8")); }
      catch { unknown.push({ file: f, reason: "ilegible" }); continue; }
      const trials = countTrials(json);
      if (trials == null) { unknown.push({ file: f, reason: "forma no reconocida" }); continue; }
      const sharpes = collectSharpes(json);
      for (const sh of sharpes) allSharpes.push(sh);
      entries.push({ file: f, lab: prefix, note, trials, sharpesFound: sharpes.length, generatedAt: json.generatedAt ?? null });
    }
  }

  entries.sort((a, b) => b.trials - a.trials || a.file.localeCompare(b.file));
  const totalTrials = entries.reduce((s, e) => s + e.trials, 0);

  // Dispersion de Sharpe entre TODOS los ensayos. Los artefactos los guardan ANUALIZADOS;
  // el Sharpe deflactado trabaja en la periodicidad de la serie (mensual): de ahi el /sqrt(12).
  const PERIODS = 12;
  const monthly = allSharpes.map((x) => x / Math.sqrt(PERIODS));
  let sharpeStdDevMonthly = null, sharpeMeanMonthly = null;
  if (monthly.length > 1) {
    sharpeMeanMonthly = monthly.reduce((s, x) => s + x, 0) / monthly.length;
    sharpeStdDevMonthly = Math.sqrt(monthly.reduce((s, x) => s + (x - sharpeMeanMonthly) ** 2, 0) / (monthly.length - 1));
  }

  return {
    generatedAt: new Date().toISOString(),
    totalTrials,
    artifacts: entries.length,
    isLowerBound: true,
    note:
      "COTA INFERIOR del número de ensayos evaluados sobre la misma historia de mercado. " +
      "Solo cuenta variantes que dejaron artefacto en research/out/. Las exploradas y " +
      "descartadas sin guardar no aparecen, así que el M real es mayor y el listón de " +
      "significancia (SR0 del Sharpe deflactado) es MÁS ALTO que el que se deriva de aquí.",
    sharpeSamples: monthly.length,
    sharpeMeanMonthly: sharpeMeanMonthly != null ? +sharpeMeanMonthly.toFixed(5) : null,
    sharpeStdDevMonthly: sharpeStdDevMonthly != null ? +sharpeStdDevMonthly.toFixed(5) : null,
    entries,
    uncounted: unknown,
  };
}

/** Dispersion de Sharpe (mensual) entre todos los ensayos registrados. null si no hay libro. */
export function readLedgerDispersion() {
  if (!existsSync(LEDGER)) return null;
  try {
    const j = JSON.parse(readFileSync(LEDGER, "utf8"));
    if (!Number.isFinite(j.sharpeStdDevMonthly) || !Number.isFinite(j.totalTrials)) return null;
    return { trials: j.totalTrials, sdMonthly: j.sharpeStdDevMonthly, samples: j.sharpeSamples };
  } catch { return null; }
}

/** Total acumulado para quien calcule el Sharpe deflactado. null si no hay libro. */
export function readLedgerTotal() {
  if (!existsSync(LEDGER)) return null;
  try {
    const j = JSON.parse(readFileSync(LEDGER, "utf8"));
    return Number.isFinite(j.totalTrials) ? j.totalTrials : null;
  } catch { return null; }
}

// CLI
if (process.argv[1] && process.argv[1].endsWith("trialsLedger.mjs")) {
  const ledger = buildLedger();
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  console.log(`\n  LIBRO DE ENSAYOS · ${ledger.totalTrials} ensayos contados en ${ledger.artifacts} artefactos\n`);
  console.log("  ensayos  laboratorio                    fichero");
  for (const e of ledger.entries) {
    console.log(`  ${String(e.trials).padStart(7)}  ${e.lab.padEnd(28)}  ${e.file}`);
  }
  if (ledger.uncounted.length) {
    console.log(`\n  sin contar (${ledger.uncounted.length}): ${ledger.uncounted.map((u) => u.file).join(", ")}`);
  }
  if (ledger.sharpeStdDevMonthly != null) {
    console.log(`
  Dispersion de Sharpe entre ensayos: sd ${ledger.sharpeStdDevMonthly.toFixed(4)}/mes sobre ${ledger.sharpeSamples} muestras (media ${ledger.sharpeMeanMonthly.toFixed(4)}/mes)`);
  }
  console.log(`\n  ⚠️  Cota INFERIOR: solo cuenta lo que dejó artefacto. El M real es mayor.`);
  console.log(`  → research/out/trials_ledger.json\n`);
}
