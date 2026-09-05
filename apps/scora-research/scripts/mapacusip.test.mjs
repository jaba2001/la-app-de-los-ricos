// ─────────────────────────────────────────────────────────────────────────────
// EL EMPAREJAMIENTO CUSIP → TICKER
//
// Cada caso de aquí salió de un fallo REAL medido contra la SEC el 2026-09-02, no de imaginar
// qué podría pasar. Los nombres son los que fallaban de verdad.
//
//   node --experimental-strip-types --no-warnings scripts/mapacusip.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { norm, normSinEspacios, esPreferente, claseDeTitulo, claseDeTicker, resolver, decodificar } from "../lib/mapaCusip.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`);
const casa = (a, b, m) => ok(norm(a) === norm(b), `${m} — "${a}" -> "${norm(a)}" ≠ "${b}" -> "${norm(b)}"`);

// ── El apóstrofo, que era el fallo más caro ──────────────────────────────────────────────
// La SEC escribe LOWES; el N-PORT, LOWE'S. Sustituirlo por un espacio daba `LOWE S COMPANIES`,
// que no casa con nada. Se lleva por delante a media docena de nombres del índice de una vez.
casa("LOWE'S COMPANIES INC", "LOWES COMPANIES INC", "Lowe's");
casa("MCDONALD'S CORP", "MCDONALDS CORP", "McDonald's");
casa("MOODY'S CORP", "MOODYS CORP /DE/", "Moody's, y con sufijo de estado");
ok(norm("LOWE'S").includes("LOWES"), "el apóstrofo se borra, no se espacia");

// ── El guion ─────────────────────────────────────────────────────────────────────────────
casa("COCA-COLA COMPANY (THE)", "COCA COLA CO", "Coca-Cola, con guion y con (THE)");
casa("BRISTOL-MYERS SQUIBB COMPANY", "BRISTOL MYERS SQUIBB CO", "Bristol-Myers");
casa("TAKE-TWO INTERACTIVE SOFTWARE INC", "TAKE TWO INTERACTIVE SOFTWARE INC", "Take-Two");
casa("COLGATE-PALMOLIVE COMPANY", "COLGATE PALMOLIVE CO", "Colgate-Palmolive");

// ── El sufijo de estado, en sus dos formas ───────────────────────────────────────────────
// `US BANCORP \DE\` lleva BARRAS INVERTIDAS, no las normales. Una sola de las dos formas deja
// fuera la mitad de los casos.
casa("US BANCORP", "US BANCORP \\DE\\", "barra invertida");
casa("APPLIED MATERIALS INC", "APPLIED MATERIALS INC /DE", "barra normal sin cerrar");
casa("BANK OF AMERICA CORP", "BANK OF AMERICA CORP /DE/", "barra normal cerrada");
casa("WELLS FARGO & COMPANY", "WELLS FARGO & COMPANY/MN", "sufijo de estado pegado, y con &");

// ── La barra DESNUDA, sin código de estado detrás ────────────────────────────────────────
// Exigir dos letras tras la barra dejaba fuera a Ametek, Mettler-Toledo y Vertex: tres de los
// nueve nombres del S&P 500 que faltaban.
casa("AMETEK INC", "AMETEK INC/", "barra final sin nada detrás");
casa("METTLER-TOLEDO INTERNATIONAL INC", "METTLER TOLEDO INTERNATIONAL /", "barra con espacio delante");
casa("VERTEX PHARMACEUTICALS INC", "VERTEX PHARMACEUTICALS INC / MA", "barra con espacios a los dos lados");

// ── Las abreviaturas con puntos ──────────────────────────────────────────────────────────
// Quitar los puntos primero deja `N` y `V` sueltas, que ya no casan con el `NV` del fondo.
casa("NXP Semiconductors NV", "NXP Semiconductors N.V.", "N.V. contra NV");
casa("LyondellBasell Industries NV", "LyondellBasell Industries N.V", "y sin el punto final");

// ── Signos que no son ruido societario ───────────────────────────────────────────────────
casa("YUM! BRANDS INC", "YUM BRANDS INC", "la exclamación de Yum!");

// ── El ampersand y el orden de palabras ──────────────────────────────────────────────────
casa("Air Products & Chemicals", "AIR PRODUCTS AND CHEMICALS INC", "& contra AND");
casa("SMITH A O CORP", "A. O. Smith Corp", "orden de palabras: la SEC pone el apellido primero");
casa("Moelis &amp; Co", "MOELIS & CO", "entidad XML sin decodificar no casa con nada");
eq(decodificar("Moelis &amp; Co"), "Moelis & Co", "decodificar entidades");

// ── La clave sin espacios, sólo como segundo intento ─────────────────────────────────────
ok(norm("JP MORGAN CHASE & COMPANY") !== norm("JPMORGAN CHASE & CO"), "con espacios NO casan (por eso hace falta la segunda clave)");
ok(normSinEspacios("JP MORGAN CHASE & COMPANY") === normSinEspacios("JPMORGAN CHASE & CO"), "sin espacios sí");

// ── Preferentes: el falso amigo del guion ────────────────────────────────────────────────
// Lo que marca la preferente es la P, no el guion. BRK-A y BF-B son CLASES DE LA COMÚN, y
// tratarlas como preferentes borraría a Berkshire del mapa.
ok(esPreferente("NEE-PN"), "NEE-PN es preferente");
ok(esPreferente("WFC-PY"), "WFC-PY es preferente");
ok(esPreferente("SCHW-PD"), "SCHW-PD es preferente");
ok(!esPreferente("BRK-A"), "BRK-A NO es preferente: es clase A de la común");
ok(!esPreferente("BF-B"), "BF-B NO es preferente");
ok(!esPreferente("MOG-A"), "MOG-A NO es preferente");
ok(!esPreferente("AAPL"), "un ticker sin guion no es preferente");

// ── La clase, del título y del ticker ────────────────────────────────────────────────────
eq(claseDeTitulo("ALPHABET INC CAP STK CL C"), "C", "clase C del título de Alphabet");
eq(claseDeTitulo("BERKSHIRE HATHAWAY INC CL B"), "B", "clase B de Berkshire");
eq(claseDeTitulo("APPLE INC"), null, "sin clase declarada, no se inventa");
eq(claseDeTicker("BRK-A"), "A", "el ticker declara su clase");
eq(claseDeTicker("BRK-B"), "B", "y la otra");
eq(claseDeTicker("NEE-PN"), null, "una preferente no declara clase de común");
eq(claseDeTicker("GOOGL"), null, "⚠️ GOOGL NO declara clase: la L no es una letra de clase");

// ── resolver(): el orden de los filtros ──────────────────────────────────────────────────
// 1 · un solo candidato
eq(resolver(["AAPL"]).ticker, "AAPL", "candidato único");

// 2 · las preferentes se van, y queda uno. Es el caso de NEE (7 candidatos) y WFC (8).
eq(resolver(["NEE", "NEE-PN", "NEE-PT", "NEE-PU", "NEE-PW", "NEE-PV", "NEE-PS"]).ticker, "NEE",
   "siete candidatos, seis preferentes: queda NEE");
eq(resolver(["WFC", "WFC-PY", "WFC-PL", "WFC-PC", "WFC-PD", "WFC-PZ", "WFC-PA"]).ticker, "WFC", "igual con Wells Fargo");
eq(resolver(["C", "C-PN", "C-PR"]).ticker, "C", "y con Citigroup");

// 3 · el universo decide cuando quedan varios comunes. CCZ no está en el S&P 500; CMCSA sí.
const universo = new Set(["CMCSA", "GOOGL", "GOOG", "BRK.B", "DUK", "SPG"]);
eq(resolver(["CMCSA", "CCZ"], { universo }).ticker, "CMCSA", "el universo descarta el híbrido");
eq(resolver(["DUK", "DUKB", "DUK-PA", "DUKU"], { universo }).ticker, "DUK", "preferente + universo");
eq(resolver(["SPG", "SPG-PJ"], { universo }).ticker, "SPG", "Simon Property");
// BRK-B se escribe BRK.B en la tabla del índice: la comparación tiene que ver las dos formas.
eq(resolver(["BRK-A", "BRK-B"], { universo }).ticker, "BRK-B", "BRK-A no está en el universo, BRK-B sí (como BRK.B)");

// 4 · la clase del título, cuando el ticker la lleva
eq(resolver(["BRK-A", "BRK-B"], { titulo: "BERKSHIRE HATHAWAY INC CL A" }).ticker, "BRK-A",
   "sin universo, la clase del título decide");

// 5 · lo que NO se puede deducir se queda fuera, no se adivina
const amb = resolver(["GOOGL", "GOOG"], { universo, titulo: "ALPHABET INC CAP STK CL C" });
eq(amb.ticker, null, "GOOGL/GOOG no se deduce de las letras: se queda ambiguo");
eq(amb.via, "ambiguo", "y lo dice");

// 6 · …salvo con la tabla revisada, que va con su evidencia
const tabla = { [`${norm("ALPHABET INC")}|C`]: "GOOG", [`${norm("ALPHABET INC")}|A`]: "GOOGL" };
eq(resolver(["GOOGL", "GOOG"], { universo, titulo: "ALPHABET INC CAP STK CL C", tabla }).ticker, "GOOG",
   "la tabla revisada resuelve la clase C");
eq(resolver(["GOOGL", "GOOG"], { universo, titulo: "ALPHABET INC CAP STK CL A", tabla }).ticker, "GOOGL",
   "y la clase A");
eq(resolver(["GOOGL", "GOOG"], { universo, titulo: "ALPHABET INC CAP STK CL A", tabla }).via, "tabla",
   "y marca que salió de la tabla, no de una deducción");

// 7 · una tabla que no cubre el caso no fuerza nada
eq(resolver(["FOXA", "FOX"], { titulo: "FOX CORP CL B", tabla }).ticker, null,
   "sin entrada en la tabla se queda ambiguo, no coge el primero");

// 8 · sin candidatos
eq(resolver([]).via, "sin candidatos", "lista vacía");

console.log(`\n${fail ? "✖" : "✓"} mapaCusip: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
