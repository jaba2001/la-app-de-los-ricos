// ─────────────────────────────────────────────────────────────────────────────
// LA VIDA ÚTIL IMPLÍCITA
//
// Lo que fija este fichero no es la división `bruto / depreciación` —eso es aritmética— sino
// las tres cosas que hacen que esa división MIENTA:
//
//   1. Que el crecimiento del activo infla la cifra por sí solo. Medido sobre Oracle: 15,4
//      años con la fórmula ingenua contra 12,2 con base media. La mitad era artefacto.
//   2. Que sin el dato de apertura NO se cae a la fórmula ingenua en silencio.
//   3. Que la señal no puede separar «cambió el criterio contable» de «cambió lo que compra»,
//      y por eso nunca es una alerta.
//
//   node --experimental-strip-types --no-warnings scripts/vidautil.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { vidaUtil, señalesVida, UMBRALES_VIDA } from "../lib/vidaUtil.ts";
import { readFileSync } from "fs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };
const cerca = (a, b, tol, m) => ok(a != null && Math.abs(a - b) <= tol, `${m} — esperado ${b}, salió ${a}`);
const tiene = (ss, k) => ss.some((x) => x.clave === k);

// ── La aritmética, con números redondos ──────────────────────────────────────────────────
{
  // Activo estable: bruto 1.000 los dos años, depreciación 100 → 10 años, sin sesgo.
  const v = vidaUtil({ depreciacion: 100, brutoFin: 1000, brutoIni: 1000 });
  cerca(v.vidaIngenua, 10, 1e-9, "sin crecimiento, la ingenua da 10 años");
  cerca(v.vidaCorregida, 10, 1e-9, "y la corregida también");
  cerca(v.sesgoCrecimiento, 0, 1e-9, "sin crecimiento no hay sesgo");
  cerca(v.crecimientoActivo, 0, 1e-9, "y el crecimiento es cero");
}

// ── LO QUE MÁS IMPORTA (1): el crecimiento del activo infla la cifra solo ────────────────
// ⚠️ Este bloque existe por una medición real: Oracle 2025 daba 15,4 años con la fórmula
// ingenua y 12,2 con base media, con el activo creciendo un 71 %. La mitad del aparente
// alargamiento no era contabilidad: era que lo comprado ese año aún no había depreciado.
{
  // El activo se duplica: 1.000 → 2.000, depreciación 150.
  const v = vidaUtil({ depreciacion: 150, brutoFin: 2000, brutoIni: 1000 });
  cerca(v.vidaIngenua, 2000 / 150, 1e-9, "la ingenua usa el bruto de CIERRE: 13,3 años");
  cerca(v.vidaCorregida, 1500 / 150, 1e-9, "la corregida usa la base MEDIA: 10 años");
  ok(v.vidaIngenua > v.vidaCorregida, "la ingenua siempre exagera cuando el activo crece");
  cerca(v.sesgoCrecimiento, 2000 / 150 - 10, 1e-9, "y el sesgo se publica en años, para poder verlo");
  cerca(v.crecimientoActivo, 1, 1e-9, "crecimiento del 100 %");
  ok(v.ruidoso, "y por encima del 50 % de crecimiento se marca como ruidoso");

  // Con el activo ENCOGIENDO el sesgo va al revés, y también hay que fijarlo.
  const c = vidaUtil({ depreciacion: 150, brutoFin: 1000, brutoIni: 2000 });
  ok(c.vidaIngenua < c.vidaCorregida, "si el activo encoge, la ingenua se queda CORTA");
  ok(!c.ruidoso, "encoger no dispara el aviso de ruido (el umbral es al alza)");
}

// ── LO QUE MÁS IMPORTA (2): sin apertura NO se cae a la ingenua en silencio ──────────────
{
  const v = vidaUtil({ depreciacion: 100, brutoFin: 1000 });
  ok(v.vidaIngenua != null, "la ingenua sí se puede calcular sin la apertura");
  ok(v.vidaCorregida === null, "pero la CORREGIDA es null: no se devuelve la sesgada disfrazada de buena");
  ok(v.crecimientoActivo === null, "ni se inventa un crecimiento");
  ok(señalesVida(v).length === 0, "y sin la corregida no se emite ninguna señal");

  ok(vidaUtil({}).vidaCorregida === null, "sin nada, todo null");
  ok(vidaUtil({ depreciacion: 0, brutoFin: 1000, brutoIni: 900 }).vidaCorregida === null,
     "depreciación cero: null, no Infinity");
  ok(vidaUtil({ depreciacion: -50, brutoFin: 1000, brutoIni: 900 }).vidaCorregida === null,
     "depreciación negativa: null, no una vida negativa");
}

// ── El cambio, que es lo único que informa ───────────────────────────────────────────────
{
  // Antes 10 años (1.000/100), ahora 12,5 (base media 1.250 / dep 100) → +25 %.
  const v = vidaUtil({
    depreciacion: 100, brutoFin: 1400, brutoIni: 1100,
    prev: { depreciacion: 100, brutoFin: 1100, brutoIni: 900 },
  });
  ok(v.vidaPrevia != null && v.cambio != null, "con el año anterior se puede medir el cambio");
  ok(v.cambio > 0, "y aquí la vida se alarga");
  const s = señalesVida(v);
  ok(tiene(s, "vida_util_alargada"), `alargarla más del ${UMBRALES_VIDA.extensionMinima * 100} % levanta señal`);
  ok(s[0].evidencia.vidaAntes != null && s[0].evidencia.vidaAhora != null, "con las dos vidas en la evidencia");
  ok(s[0].evidencia.beneficioAnadido > 0, "y el beneficio que la extensión añade, cuantificado");

  // ⚠️ ACORTARLA TAMBIÉN SE SEÑALA. Es lo contrario de un maquillaje y por eso informa:
  // Amazon lo hizo en 2025 citando «el ritmo de desarrollo tecnológico, particularmente en IA».
  const corto = vidaUtil({
    depreciacion: 140, brutoFin: 1100, brutoIni: 900,
    prev: { depreciacion: 100, brutoFin: 900, brutoIni: 700 },
  });
  ok(tiene(señalesVida(corto), "vida_util_acortada"), "acortarla también se señala");
  ok(señalesVida(corto)[0].evidencia.beneficioAnadido === undefined,
     "y ahí NO se publica «beneficio añadido»: acortar RESTA beneficio");

  // Justo en el umbral no salta: los cortes son estrictos.
  const justo = vidaUtil({ depreciacion: 100, brutoFin: 1000, brutoIni: 1000,
    prev: { depreciacion: 100, brutoFin: 1000, brutoIni: 1000 } });
  ok(señalesVida(justo).length === 0, "sin cambio, ninguna señal");
}

// ── LO QUE MÁS IMPORTA (3): la señal NO acusa ───────────────────────────────────────────
// ⚠️ Un centro de datos son dos cosas con vidas opuestas: el edificio (décadas) y los
// servidores (pocos años). Si la inversión se desplaza hacia obra civil, la vida implícita
// SUBE sin que nadie haya tocado una estimación. La métrica no puede separarlo, así que no
// puede acusar.
{
  const v = vidaUtil({ depreciacion: 100, brutoFin: 1400, brutoIni: 1100,
    prev: { depreciacion: 100, brutoFin: 1100, brutoIni: 900 } });
  const s = señalesVida(v);
  ok(s.length > 0 && s.every((x) => x.gravedad === "aviso"),
     "toda señal de vida útil es AVISO, nunca alerta: la métrica no distingue criterio de mezcla");
  ok(/NO las distingue|no las distingue/.test(s[0].texto),
     "y el texto lo dice explícitamente, no lo deja al lector");
  ok(!/fraude|maquilla|manipul|engañ/i.test(s[0].texto), "y no acusa de nada");

  // Con el activo disparado el texto lo advierte además.
  const r = vidaUtil({ depreciacion: 100, brutoFin: 2200, brutoIni: 1100,
    prev: { depreciacion: 100, brutoFin: 1100, brutoIni: 900 } });
  ok(r.ruidoso && /ruidosa/.test(señalesVida(r)[0].texto), "y si el activo crece mucho, el texto lo avisa");
}

// ── Valores absurdos: se descartan en vez de publicarse ─────────────────────────────────
{
  const v = vidaUtil({ depreciacion: 1, brutoFin: 1000, brutoIni: 1000 });   // 1.000 años
  ok(v.fuera, "una vida de 1.000 años se marca como fuera de banda");
  ok(señalesVida(v).length === 0, "y no genera señal: es un problema de datos, no una política");
  const c = vidaUtil({ depreciacion: 1000, brutoFin: 1000, brutoIni: 1000 });  // 1 año
  ok(c.fuera, "una vida de 1 año, igual");
}

// ── Que el módulo diga lo mismo que el análisis publicado ───────────────────────────────
// ⚠️ Las cifras de Oracle y Microsoft están escritas en PLAN_CUATRO_VIDEOS.md. Si alguien
// cambia la fórmula, el documento pasa a mentir sin que nada falle. Aquí falla.
{
  const doc = readFileSync("PLAN_CUATRO_VIDEOS.md", "utf8");
  // ORCL 2025: dep 3,9 B$, bruto 60 B$ fin y 35 B$ inicio.
  const orcl = vidaUtil({ depreciacion: 3.9e9, brutoFin: 60e9, brutoIni: 35e9 });
  cerca(orcl.vidaIngenua, 15.4, 0.3, "ORCL 2025 ingenua ≈ 15,4 años, como dice el documento");
  cerca(orcl.vidaCorregida, 12.2, 0.4, "y corregida ≈ 12,2");
  ok(doc.includes("15,4") && doc.includes("12,2"), "y el documento publica esas dos cifras");
  ok(orcl.vidaIngenua - orcl.vidaCorregida > 3, "el sesgo de Oracle pasa de 3 años: no es un matiz");

  // ⚠️ MICROSOFT ES EL CASO QUE CAMBIA DE SENTIDO, y el documento lo publica sin nada que lo
  // guardara hasta esta auditoría. Con la fórmula ingenua su vida útil parece estable; con la
  // corrección BAJA. Es la prueba de que la corrección no sólo atenúa: puede invertir la lectura.
  // MSFT 2025: dep 22,0 B$, bruto 299 B$ al cierre y 212 al inicio.
  const msft = vidaUtil({ depreciacion: 22.0e9, brutoFin: 299e9, brutoIni: 212e9 });
  cerca(msft.vidaIngenua, 13.6, 0.2, "MSFT 2025 ingenua ≈ 13,6 años, como dice el documento");
  cerca(msft.vidaCorregida, 11.6, 0.2, "y corregida ≈ 11,6");
  ok(doc.includes("13,6") && doc.includes("11,6"), "y el documento publica esas dos");
  // MSFT 2023: dep 11,0 B$, bruto 164 fin y 134 inicio → ingenua 14,9 · corregida 13,5.
  const msft23 = vidaUtil({ depreciacion: 11.0e9, brutoFin: 164e9, brutoIni: 134e9 });
  cerca(msft23.vidaCorregida, 13.5, 0.2, "MSFT 2023 corregida ≈ 13,5");
  ok(msft.vidaCorregida < msft23.vidaCorregida,
     "y de 2023 a 2025 la vida corregida de Microsoft BAJA — lo contrario de «todos están alargando»");
}

console.log(pass && !fail ? `\n✓ vidaUtil: ${pass} passed, 0 failed\n` : `\n✖ vidaUtil: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
