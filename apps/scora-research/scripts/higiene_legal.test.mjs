// Higiene legal antes de la beta (plan único, pieza 1.2). Fija cinco cosas:
//   (a) el asistente de pantalla no se monta en las páginas con datos personales;
//   (b) el optimizador no se rellena con las posiciones del diario ni destaca una columna;
//   (c) mientras la licencia no cubra el canal CSV, solo se exportan tickers;
//   (d) toda salida de IA dice que la ha generado una IA (Ley de IA, art. 50.1);
//   (e) ningún texto de la app usa lenguaje de recomendación (entradas, stops, objetivos).
//
//   node --experimental-strip-types --no-warnings scripts/higiene_legal.test.mjs
//
// Cada comprobación se vio fallar con el código anterior o con un sabotaje (ver la PR).
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { asistenteVisibleEn } from "../lib/rutasSinAsistente.ts";
import { tickersDeTexto, MAX_TICKERS_OPTIMIZADOR } from "../lib/optimize.ts";
import { EXPORTAR_METRICAS, csvDeTickers } from "../lib/licencia.ts";
import { computeTLResult, computeSqueeze, computeADX, computeVolumeProfile } from "../lib/technicalIndicators.ts";
import { compilar, traducir, tieneTraduccion } from "../lib/i18n/traducir.ts";
import { ES } from "../lib/i18n/es/index.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log(`  ✖ ${m}`); } };
// Sin comentarios: lo que se vigila es lo que ve el usuario, no la explicación de por qué se quitó.
const fuente = (f) => readFileSync(f, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const D = compilar(ES);
const es = (txt) => traducir(txt, "es", D);

// ── (a) El asistente, fuera de las páginas personales ─────────────────────────────────────
{
  for (const r of ["/journal", "/journal/", "/audit", "/account", "/login", "/auth/callback"])
    ok(!asistenteVisibleEn(r), `sin asistente en ${r}`);
  // «/journalist» no es el diario: la regla mira el segmento entero, no el prefijo.
  for (const r of ["/", "/stock/AAPL", "/macro", "/watchlist", "/picks", "/journalist"])
    ok(asistenteVisibleEn(r), `con asistente en ${r}`);
  const sa = fuente("components/ScreenAssistant.tsx");
  ok(/asistenteVisibleEn\(pathname\)/.test(sa), "ScreenAssistant decide con asistenteVisibleEn");
  ok(/if \(!visible\) return null;/.test(sa), "en una página personal no se pinta ni el botón ni el panel");
  // Si el panel estaba abierto al entrar en el diario, la selección del diario no se guarda.
  ok(/if \(!abierto \|\| !visible\) return;\s*const alCambiar/.test(sa), "la selección solo se escucha con el panel visible");
  ok(/if \(!abierto \|\| !visible\) return;\s*document\.documentElement\.classList\.add/.test(sa),
     "y la página no queda estrechada para un panel que no se ve");
}

// ── (b) El optimizador no lee el diario ──────────────────────────────────────────────────
{
  const diario = fuente("app/journal/page.tsx");
  ok(/<PortfolioOptimizer\s*\/>/.test(diario), "el diario monta el optimizador sin pasarle nada");
  ok(!/<PortfolioOptimizer[^>]*tickers=/.test(diario), "…y en particular sin sus posiciones");
  const opt = fuente("components/journal/PortfolioOptimizer.tsx");
  ok(!/--sr-amber/.test(opt), "ninguna columna del optimizador se destaca como la buena");
  ok(!/export default function PortfolioOptimizer\(\s*\{/.test(opt), "el optimizador no acepta props");
  ok(JSON.stringify(tickersDeTexto("aapl, msft  NVDA;aapl")) === JSON.stringify(["AAPL", "MSFT", "NVDA"]),
     "tickersDeTexto: mayúsculas, separadores y sin repetir");
  ok(tickersDeTexto("BRK.B 0700.HK $$$ abcdefghijklmnopq").join() === "BRK.B,0700.HK",
     "tickersDeTexto: descarta lo que no es un símbolo válido");
  ok(tickersDeTexto(Array.from({ length: 30 }, (_, i) => `T${i}`).join(" ")).length === MAX_TICKERS_OPTIMIZADOR,
     `tickersDeTexto: se queda en el tope de ${MAX_TICKERS_OPTIMIZADOR} (cada ticker es una llamada a FMP)`);
}

// ── (c) Sin licencia, solo tickers ───────────────────────────────────────────────────────
{
  ok(EXPORTAR_METRICAS === false,
     "EXPORTAR_METRICAS sigue apagado: se enciende solo cuando la licencia cubra el CSV, y se dice en la PR");
  const csv = csvDeTickers(["AAPL", "BRK.B", 'A"B']);
  ok(csv === '"Ticker"\n"AAPL"\n"BRK.B"\n"A""B"', "el CSV sin licencia es una sola columna de tickers (RFC 4180)");
  ok(!csv.includes(","), "…sin ninguna otra columna");
  ok(/if \(!EXPORTAR_METRICAS\) \{\s*descargarCSV\(csvDeTickers\(/.test(fuente("components/stock/StockScreener.tsx")),
     "el screener exporta solo tickers mientras no haya licencia");
  ok(/\{EXPORTAR_METRICAS && !loading && data && \(/.test(fuente("app/stock/[ticker]/page.tsx")),
     "la ficha no ofrece exportar sus métricas sin licencia");
}

// ── (d) Toda salida de IA dice que es IA ─────────────────────────────────────────────────
{
  const badge = fuente("components/ui/GroundedBadge.tsx");
  ok(/t\("AI-generated"\)/.test(badge), "la etiqueta de IA existe");
  ok(/export function GroundedBadge[\s\S]*<EtiquetaIA \/>/.test(badge), "y el distintivo de las salidas de IA la lleva");
  ok(es("AI-generated") === "Generado con IA", "…también en español");
  // Cada componente que genera texto con aiAnalyzeAudited pinta el distintivo o la etiqueta.
  const sinEtiqueta = [];
  function* ficheros(dir) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (f !== "node_modules") yield* ficheros(p); }
      else if (/\.tsx$/.test(f)) yield p;
    }
  }
  let conIA = 0;
  for (const raiz of ["app", "components"]) {
    for (const f of ficheros(raiz)) {
      const s = fuente(f);
      if (!/aiAnalyzeAudited\(/.test(s)) continue;
      conIA++;
      if (!/<GroundedBadge\b|<EtiquetaIA\b/.test(s)) sinEtiqueta.push(f);
    }
  }
  ok(conIA >= 8, `se encuentran las salidas de IA (${conIA}); si son menos, la búsqueda dejó de ver algo`);
  ok(sinEtiqueta.length === 0, `salidas de IA sin la etiqueta: ${sinEtiqueta.join(", ")}`);
  ok(/Sends this page's content to the AI/.test(fuente("components/ScreenAssistant.tsx")),
     "el asistente de pantalla mantiene su propio aviso");
}

// ── (e) Sin lenguaje de recomendación ────────────────────────────────────────────────────
{
  // Las del código anterior, sus traducciones, y las del borrador de Trading Latino (sesión
  // a83d1ada), para que la pieza 2.2 no las reintroduzca.
  const PROHIBIDAS = [
    "Entry confirmed", "SHORT entry", "Entrada confirmada", "Entrada CORTA", "IC DUAL GATE",
    "Long Stop", "Short Stop", "Long TP1", "Short TP1", "LEAN LONG", "LEAN SHORT",
    "Compra confirmada", "Señal de salida", "Bajista: no se compra", "Scora + timing",
  ];
  const halladas = [];
  function* todos(dir) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (f !== "node_modules") yield* todos(p); }
      else if (/\.(tsx|ts|js)$/.test(f)) yield p;
    }
  }
  for (const raiz of ["app", "components", "lib"])
    for (const f of todos(raiz)) {
      const s = fuente(f);
      for (const p of PROHIBIDAS) if (s.includes(p)) halladas.push(`${f}: «${p}»`);
    }
  ok(halladas.length === 0, `lenguaje de recomendación en la app: ${halladas.join("; ")}`);

  // El resultado del método, sobre una serie sintética: describe y no ordena.
  const bars = [];
  let precio = 100;
  for (let i = 0; i < 160; i++) {
    const ruido = Math.sin(i * 1.7) * 0.8;
    precio += 0.35 + ruido * 0.3;
    bars.push({ open: precio, high: precio + 1 + Math.abs(ruido), low: precio - 1 - Math.abs(ruido), close: precio + ruido, volume: 1e6 + i * 1000 });
  }
  const closes = bars.map((b) => b.close);
  const media = (n) => closes.map((_, i) => closes.slice(Math.max(0, i - n + 1), i + 1).reduce((a, b) => a + b, 0) / Math.min(n, i + 1));
  const rapida = media(10), lenta = media(55);
  const hist = bars.map((b, i) => ({ high: b.high, low: b.low, price: b.close, emaFast: rapida[i], emaSlow: lenta[i] }));
  const sqz = computeSqueeze(bars), adx = computeADX(bars), vp = computeVolumeProfile(bars);
  for (const ic of [80, 20, 50, null]) {
    const tl = computeTLResult(closes, rapida, lenta, hist, sqz, adx, vp, ic);
    ok(tl != null, `el método se calcula (score ${ic})`);
    if (!tl) continue;
    ok(/^[0-4]\/4 (up|down)$|^Mixed$/.test(tl.bias), `etiqueta descriptiva: «${tl.bias}»`);
    ok(tieneTraduccion(tl.bias, D) && tieneTraduccion(tl.gate, D), `con traducción: «${tl.bias}» y «${tl.gate}»`);
    ok(!("stopLong" in tl) && !("tp1Long" in tl), "sin stops ni objetivos");
  }

  // Cada lectura posible, traducida entera (incluidos los datos).
  const casos = [
    ["3/4 up", "3/4 al alza"],
    ["2/4 down", "2/4 a la baja"],
    ["Mixed", "Mixto"],
    ["Fewer than 3 of the 4 conditions agree", "Menos de 3 de las 4 condiciones coinciden"],
    ["Technical and fundamental readings agree: 3/4 conditions up, Scora score 72", "La lectura técnica y la fundamental coinciden: 3/4 condiciones al alza, Scora score 72"],
    ["Technical and fundamental readings agree: 4/4 conditions down, Scora score 30", "La lectura técnica y la fundamental coinciden: 4/4 condiciones a la baja, Scora score 30"],
    ["Readings disagree: 3/4 conditions up, Scora score 20", "Las dos lecturas no coinciden: 3/4 condiciones al alza, Scora score 20"],
    ["Readings disagree: 3/4 conditions down, Scora score 70", "Las dos lecturas no coinciden: 3/4 condiciones a la baja, Scora score 70"],
    ["High Scora score (70); 2/4 conditions up", "Scora score alto (70); 2/4 condiciones al alza"],
    ["Low Scora score (31); 2/4 conditions down", "Scora score bajo (31); 2/4 condiciones a la baja"],
  ];
  for (const [en, esperado] of casos) ok(es(en) === esperado, `«${en}» → «${es(en)}»`);
}

// ── Los textos nuevos tienen traducción ──────────────────────────────────────────────────
// scripts/i18n.test.mjs solo reconoce t("…"), y estos componentes llaman a la función como tr()
// o pasan el texto por tv(): sin esto, un texto sin traducir saldría en inglés sin aviso.
{
  const NUEVOS = [
    "Min-variance & max-Sharpe weights for the tickers you enter, with Ledoit-Wolf shrinkage and resampled uncertainty bands. A calculation, not a recommendation: it does not read your journal.",
    "Enter at least 2 different tickers to optimize.", "Tickers, e.g. AAPL, MSFT, NVDA", "Tickers to optimize",
    `Up to ${MAX_TICKERS_OPTIMIZADOR} tickers.`, "↓ Export tickers (CSV)", "Technical vs fundamental reading",
    "Reference levels on the chart: a description, not a recommendation.", "EMA 55", "20-session low",
    "20-session high", "POC (volume)", "Without the Scora score, only the technical reading is shown.",
    "Up", "Down",
  ];
  for (const txt of NUEVOS) ok(tieneTraduccion(txt, D), `traducido: «${txt}»`);
}

console.log(fail ? `\n✖ higiene legal: ${pass} passed, ${fail} failed\n` : `\n✓ higiene legal: ${pass} passed, 0 failed\n`);
process.exit(fail ? 1 : 0);
