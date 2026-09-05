// ─────────────────────────────────────────────────────────────────────────────
// FASE 5b · LA COMPUERTA DE LA PROSA
//
// Lo que se fija aquí no es que el modelo escriba bien —eso no se puede fijar— sino que **nada
// que no esté en los datos llegue a publicarse**. El modelo sólo puede empeorar la forma.
//
// El primer test es el más importante y el que justifica que este módulo exista: la compuerta que
// ya había en `lib/grounding.ts` es SÓLO INGLESA, y la narrativa de Scora está en español.
//
//   node --experimental-strip-types --no-warnings scripts/narrativallm.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { revisar, prosaOFallback, construirPrompt, bloqueDeDatos, PATRONES_CONSEJO, PATRONES_PRONOSTICO, PATRONES_CAUSA } from "../lib/narrativaLLM.ts";
import { checkAdvice } from "../lib/grounding.ts";
import { redactar } from "../lib/narrativa.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`);

const FILAS = [
  { ticker: "PCG", pct: -24.6, sector: "Servicios públicos" },
  { ticker: "EIX", pct: -24.6, sector: "Servicios públicos" },
  { ticker: "PYPL", pct: -14.44, sector: "Financiero" },
];
const HECHOS = [
  { tipo: "comovimiento", texto: "Dos de los tres mayores descensos son de servicios públicos.", evidencia: ["PCG", "EIX"] },
  { tipo: "extremo", texto: "El mayor descenso de la semana es PCG.", evidencia: ["PCG"] },
];

// ── 1 · POR QUÉ EXISTE ESTE MÓDULO ───────────────────────────────────────────────────────
// La compuerta inglesa da por bueno un texto en español que dice justo lo que no se puede decir.
// Si esto dejara de ser verdad —porque alguien añadiese patrones en español a grounding.ts—, este
// test fallaría y habría que replantear si el módulo sigue haciendo falta. Es deliberado.
{
  const malo = "Deberías comprar PCG ahora: es una ganancia garantizada y sin ningún riesgo.";
  eq(checkAdvice(malo), [], "la compuerta inglesa NO ve el consejo en español (por eso existe ésta)");
  const r = revisar(malo, HECHOS, FILAS);
  ok(!r.ok, "la compuerta española sí lo caza");
  ok(r.motivos.includes("recomendación imperativa"), "y dice que es una recomendación");
  ok(r.motivos.includes("certeza falsa"), "y que promete certeza");
}

// ── 2 · Números inventados ───────────────────────────────────────────────────────────────
{
  const r = revisar("PCG cayó un 24,6 % y EIX un 24,6 %.", HECHOS, FILAS);
  ok(r.ok, `un texto que sólo usa los datos pasa (motivos: ${r.motivos.join(", ")})`);

  const inv = revisar("PCG cayó un 24,6 % y acumula un descenso del 87,3 % en el año.", HECHOS, FILAS);
  ok(!inv.ok, "un número que no está en los datos NO pasa");
  ok(inv.numerosInventados.includes(87.3), "y se dice cuál es");
}

// ── 3 · Causas ───────────────────────────────────────────────────────────────────────────
// El dato es que cayó. POR QUÉ cayó no está en ninguna serie de precios.
{
  ok(!revisar("PCG cayó un 24,6 % por los incendios de California.", HECHOS, FILAS).ok, "«cayó por X» no pasa");
  ok(!revisar("El descenso se explica por la regulación.", HECHOS, FILAS).ok, "«se explica por» tampoco");
  ok(!revisar("EIX retrocedió un 24,6 %, lastrado por el sector.", HECHOS, FILAS).ok, "«lastrado por» tampoco");

  // ⚠️ Y LO QUE NO PUEDE PASAR: que «por» y «tras» como preposiciones normales bloqueen texto
  // correcto. Un listón con falsos positivos acaba desactivado — la lección de PCG/EIX.
  ok(revisar("PCG cerró por debajo del resto del grupo.", HECHOS, FILAS).ok, "«por debajo de» es una preposición, no una causa");
  ok(revisar("Tras el cierre, PCG encabeza los descensos.", HECHOS, FILAS).ok, "«tras el cierre» tampoco es una causa");
}

// ── 4 · Pronósticos ──────────────────────────────────────────────────────────────────────
{
  ok(!revisar("PCG seguirá cayendo la próxima semana.", HECHOS, FILAS).ok, "«seguirá cayendo» no pasa");
  ok(!revisar("El sector va a recuperarse.", HECHOS, FILAS).ok, "«va a recuperarse» tampoco");
  ok(!revisar("Se espera que el grupo rebote.", HECHOS, FILAS).ok, "«se espera que» tampoco");
  ok(revisar("PCG y EIX encabezan los descensos de la semana.", HECHOS, FILAS).ok, "el pasado sí pasa");
}

// ── 5 · El fallo cae siempre hacia el lado correcto ──────────────────────────────────────
{
  const bueno = prosaOFallback("PCG y EIX, ambas de servicios públicos, encabezan los descensos.", HECHOS, FILAS);
  eq(bueno.via, "modelo", "la prosa que pasa se publica");

  const malo = prosaOFallback("PCG caerá otro 50 % la semana que viene.", HECHOS, FILAS);
  eq(malo.via, "determinista", "la que no pasa, NO se publica");
  eq(malo.texto, redactar(HECHOS), "y en su lugar va el texto de 5a, que es cierto");
  ok(malo.motivos.length > 0, "diciendo por qué");

  for (const vacio of [null, undefined, "", "   "]) {
    const r = prosaOFallback(vacio, HECHOS, FILAS);
    eq(r.via, "determinista", `sin texto del modelo (${JSON.stringify(vacio)}) se cae al determinista`);
    ok(r.texto.length > 0, "y nunca se publica un hueco vacío");
  }
}

// ── 6 · El prompt y el listón salen del MISMO bloque ─────────────────────────────────────
// Si se separasen, un cambio en uno dejaría al otro comprobando algo que ya no se pide.
{
  const p = construirPrompt(HECHOS, FILAS);
  const b = bloqueDeDatos(HECHOS, FILAS);
  ok(p.usuario.includes(b), "el prompt contiene exactamente el bloque contra el que se revisa");
  ok(/PCG/.test(b) && /24\.6|24,6/.test(b), "y el bloque trae los tickers y sus cifras");
  ok(/no expliques por qu[ée]/i.test(p.sistema), "la instrucción prohíbe las causas");
  ok(/no digas qu[ée] va a pasar/i.test(p.sistema), "y los pronósticos");
}

// ── 7 · Ningún patrón puede ser una expresión que no case nunca ──────────────────────────
// Una expresión rota —una `\s` perdida al escribir el fichero, por ejemplo— convierte su patrón
// en decoración: no falla, simplemente deja de vigilar. Ya pasó este mismo día en el test del
// typecheck de `guardianes.test.mjs`, donde `/tsc\s+--noEmit/` quedó como `/tscs+--noEmit/` y la
// aserción pasaba en vacío.
//
// ⚠️ Y SE RECORREN LOS TRES GRUPOS, no uno. La primera versión de este test sólo cubría
// PATRONES_CONSEJO, y por ese hueco se coló un patrón roto: `rebotar[áa]|repuntar[áa])\b` acaba
// en `á` seguido de `\b`, y en JavaScript `\b` se define sobre `[A-Za-z0-9_]` — entre `á` y el
// espacio NO hay frontera. «El valor rebotará pronto» pasaba la compuerta limpiamente. Un test
// que cubre un grupo de tres da la misma falsa tranquilidad que el patrón que no casa.
{
  const muestras = {
    "recomendación imperativa": "Deberías comprar ahora.",
    "recomendación explícita": "Recomiendo entrar.",
    "certeza falsa": "Es una ganancia garantizada.",
    "lenguaje de venta": "Una oportunidad única.",
    "promesa de rentabilidad": "Es una ganancia segura.",
    "pronóstico de continuidad": "Seguirá cayendo.",
    "pronóstico directo": "Va a subir.",
    "pronóstico atenuado": "Se espera que suba.",
    "pronóstico de giro": "El valor rebotará pronto.",
    "causa atribuida": "PCG cayó un 5 % por los incendios.",
    "explicación causal": "El descenso se explica por la regulación.",
  };
  let cubiertos = 0;
  for (const grupo of [PATRONES_CONSEJO, PATRONES_PRONOSTICO, PATRONES_CAUSA]) {
    for (const p of grupo) {
      const m = muestras[p.etiqueta];
      ok(m != null, `el patrón «${p.etiqueta}» tiene una frase de prueba`);
      if (m != null) { ok(p.re.test(m), `«${p.etiqueta}» casa de verdad con «${m}» (si no, no vigila nada)`); cubiertos++; }
    }
  }
  ok(cubiertos === PATRONES_CONSEJO.length + PATRONES_PRONOSTICO.length + PATRONES_CAUSA.length,
     "TODOS los patrones de los tres grupos están probados");
  // Y el que se coló: la frase entera tiene que ser rechazada, no sólo casar el patrón.
  ok(!revisar("El valor rebotará pronto.", HECHOS, FILAS).ok, "«rebotará» se rechaza de punta a punta");
}

console.log(pass && !fail ? `\n✓ narrativaLLM: ${pass} passed, 0 failed\n` : `\n✖ narrativaLLM: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
