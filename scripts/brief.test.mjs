// Tests for the spoken macro brief. Pure, headless, no credentials.
// Run: node scripts/brief.test.mjs
//
// The property that matters most is the LAST one: every number spoken must come from the
// input row. The brief is deterministic precisely so that guarantee is structural, and a
// test that proves it is what keeps it that way if someone later adds a sentence.
import { buildBriefScript, monthlyChars } from "../lib/brief.js";

let passed = 0, failed = 0;
const fails = [];
const ok = (c, m) => { if (c) passed++; else { failed++; fails.push(m); } };

// A realistic row (values from the live 2026-08-10 snapshot).
const ROW = {
  snapshot_date: "2026-08-10", regime_id: "expansion", regime_label: "Expansión",
  regime_confirmation: "confirmed", risk_on: "68.6",
  risk_on_lcc: "75.4", risk_on_rpc: "22.1", risk_on_csc: "54.1",
  dgs10: "4.69", dgs2: "4.25", t10y2y: "0.46", vix: "15.15",
  hy_oas: "271", breadth_200dma: "73.6", recession_prob: "24.9",
};

const { script, chars, asOf, sections } = buildBriefScript(ROW, { cadence: "weekly" });

ok(chars > 400, `el guion tiene sustancia (${chars} chars)`);
ok(asOf === "2026-08-10", "propaga la fecha del snapshot");
ok(sections.includes("disclaimer"), "siempre incluye el descargo");
ok(/not investment advice/i.test(script), "el descargo dice explícitamente que no es asesoramiento");

// Contenido
ok(/expansion/i.test(script), "nombra el régimen");
ok(/68\.6/.test(script), "dice el valor del indicador de riesgo");
ok(/4\.69 percent/.test(script), "los porcentajes se leen como palabra, no como símbolo");
ok(!/%/.test(script), "no queda ningún '%' crudo (los TTS lo leen mal)");
ok(/46 basis points/.test(script), "convierte el diferencial de curva a puntos básicos");
ok(/positively sloped/.test(script), "0.46 → curva con pendiente positiva, no invertida");
ok(/full equity/i.test(script), "68.6 ≥ 50 → el allocator va con renta variable completa");

// Curva invertida
const inv = buildBriefScript({ ...ROW, t10y2y: "-0.35" }).script;
ok(/inverted/.test(inv) && /35 basis points/.test(inv), "diferencial negativo → dice 'inverted'");

// Risk-off cambia el mensaje de posicionamiento
const off = buildBriefScript({ ...ROW, risk_on: "31.2" }).script;
ok(/risk-off/.test(off), "por debajo de 50 → territorio risk-off");
ok(/sixty percent equity floor/.test(off), "por debajo de 50 → suelo del 60% y lastre defensivo");
ok(!/full equity/i.test(off), "por debajo de 50 NO dice renta variable completa");

// El adjetivo de volatilidad DEBE seguir al número: decir "subdued" con el VIX en 35
// sería una afirmación falsa en la voz de Scora.
ok(/subdued at 15\.2/.test(script), "VIX 15 → 'subdued'");
for (const [v, word] of [["18.4", "unremarkable"], ["26.0", "elevated"], ["41.3", "stressed"]]) {
  const s = buildBriefScript({ ...ROW, vix: v }).script;
  ok(new RegExp(`${word} at ${Number(v).toFixed(1)}`).test(s), `VIX ${v} → '${word}', no 'subdued'`);
  ok(!/subdued/.test(s), `VIX ${v} no puede describirse como 'subdued'`);
}

// Régimen sin confirmar
ok(/not yet confirmed/.test(buildBriefScript({ ...ROW, regime_confirmation: "pending" }).script),
  "régimen sin confirmar se dice en voz alta");

// Degradación con datos ausentes — un cron no puede caerse porque falte una serie de FRED
const sparse = buildBriefScript({ snapshot_date: "2026-08-10", regime_id: "slowdown" });
ok(sparse.script.length > 0, "una fila casi vacía sigue produciendo guion");
ok(/slowdown/.test(sparse.script), "usa lo que hay");
ok(!/null|undefined|NaN/.test(sparse.script), "nunca dice 'null', 'undefined' ni 'NaN'");
ok(/not investment advice/i.test(sparse.script), "el descargo sobrevive a la degradación");
const empty = buildBriefScript({ snapshot_date: null });
ok(!/null|undefined|NaN/.test(empty.script), "fila vacía: sigue sin decir null/undefined/NaN");
let threw = false;
try { buildBriefScript(null); } catch { threw = true; }
ok(threw, "sin fila, lanza en vez de emitir un guion vacío");

// LA PROPIEDAD CLAVE: ninguna cifra hablada puede salir de la nada.
// Se recogen los números del guion y se comprueba que cada uno procede de la fila, de una
// derivación declarada (puntos básicos, redondeos) o del propio texto fijo.
{
  const permitted = new Set();
  for (const v of Object.values(ROW)) {
    const num = Number(v);
    if (!Number.isNaN(num) && v !== null) {
      permitted.add(String(num));
      permitted.add(num.toFixed(1));
      permitted.add(num.toFixed(2));
      permitted.add(String(Math.round(num)));
      permitted.add(String(Math.abs(Math.round(num * 100)))); // curva → puntos básicos
    }
  }
  permitted.add("100"); // "out of one hundred" aparece como palabra, pero por si acaso
  const spoken = [...script.matchAll(/\d+(?:\.\d+)?/g)].map((x) => x[0]);
  const orphan = spoken.filter((s) => !permitted.has(s));
  ok(orphan.length === 0, `toda cifra hablada procede de la fila (huérfanas: ${orphan.join(", ")})`);
}

// Presupuesto de caracteres: es lo que decide si cabe en un free tier de TTS
const w = monthlyChars(chars, "weekly"), d = monthlyChars(chars, "daily");
ok(d > w * 5, `el diario cuesta mucho más que el semanal (${d} vs ${w} chars/mes)`);
ok(w < 12000, `el semanal se mantiene en un orden compatible con un free tier (${w} chars/mes)`);

console.log(failed === 0
  ? `\n✓ brief: ${passed} passed, 0 failed · guion ${chars} chars ≈ ${Math.round(chars / 15)}s · ${w} chars/mes (semanal)\n`
  : `\n✗ brief: ${passed} passed, ${failed} failed\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n`);
process.exit(failed ? 1 : 0);
