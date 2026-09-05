// ─────────────────────────────────────────────────────────────────────────────
// GUARDA DE LAS VÍAS DE RECONSTRUCCIÓN DEL RESULTADO DE EXPLOTACIÓN
//
// QUÉ PROTEGE, Y NO ES LO QUE PARECE. No comprueba que el código de la cuarta vía exista —eso
// lo ve cualquiera—. Comprueba **que el listón no se ha movido**, que es la forma más fácil que
// existe de aprobar una vía que no debería entrar: se mide, no pasa, y se baja el criterio.
//
// EL CONTEXTO. Cuatro vías se han evaluado para rellenar `oiTTM`, del que cuelgan cuatro de las
// cinco métricas de la señal de calidad:
//
//   pretax + intereses          RECHAZADA  desvío 7,6 % · dispersión 36,1 pp
//   bruto − gastos opex         ACEPTADA   (implementada antes; rescata poco)
//   ingresos − coste − opex     ACEPTADA   (implementada antes)
//   ingresos − costes y gastos  ACEPTADA   desvío 0,0 % · dispersión 0,0 pp · +21 nombres
//
// El criterio —desvío mediano < 5 % y dispersión sectorial < 5 pp— se escribió ANTES de mirar
// ningún resultado, y es el mismo que rechazó la vía pretax. Si alguien lo relaja para colar
// una vía nueva, o si un cambio de datos hace que una vía aceptada deje de cumplirlo, esto se
// pone rojo.
//
// ⚠️ Y VIGILA EL RECHAZO, no sólo la aprobación. Que la vía pretax siga rechazada importa
// tanto como que la cuarta siga pasando: es la que convertiría un hueco de cobertura conocido
// en una cobertura sesgada por sector, que es peor.
//
//   node --experimental-strip-types --no-warnings scripts/reconstruccion_ebit.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from "fs";

const CUARTA = new URL("../research/out/ebit_costes_gastos.json", import.meta.url);
const PRETAX = new URL("../research/out/ebit_reconstruccion.json", import.meta.url);
const EDGAR = new URL("../research/edgar.mjs", import.meta.url);

let ok = 0, fallos = 0;
const comprobar = (que, cond, detalle = "") => {
  if (cond) { ok++; } else { fallos++; console.error(`  ✗ ${que}${detalle ? ` — ${detalle}` : ""}`); }
};

console.log("\n  GUARDA DE LAS VÍAS DE RECONSTRUCCIÓN\n");

// ── 1. El criterio, tal y como se escribió ──────────────────────────────────────────────
// Estos dos números NO se tocan. Están aquí para que moverlos en el artefacto rompa el test.
const LISTON_DESVIO = 5, LISTON_DISPERSION = 5;

comprobar("existe el artefacto de la cuarta vía", existsSync(CUARTA));
comprobar("existe el artefacto de la vía pretax", existsSync(PRETAX));
if (fallos) { console.error(`\n  ⛔ faltan artefactos — ejecuta los guiones de reconstrucción\n`); process.exit(1); }

const c = JSON.parse(readFileSync(CUARTA, "utf8"));
const p = JSON.parse(readFileSync(PRETAX, "utf8"));

// ── 2. El listón no se ha movido ────────────────────────────────────────────────────────
comprobar("el listón de desvío de la cuarta vía sigue en 5 %", c.criterio?.medianaAbsMax === LISTON_DESVIO, `es ${c.criterio?.medianaAbsMax}`);
comprobar("el listón de dispersión de la cuarta vía sigue en 5 pp", c.criterio?.dispersionSectorialMax === LISTON_DISPERSION, `es ${c.criterio?.dispersionSectorialMax}`);
comprobar("el listón del pretax era EL MISMO", p.criterio?.medianaAbsMax === LISTON_DESVIO && p.criterio?.dispersionSectorialMax === LISTON_DISPERSION);
comprobar("ambos declaran que el criterio se escribió antes de mirar", c.criterio?.escritoAntesDeMirar === true && p.criterio?.escritoAntesDeMirar === true);

// ── 3. La cuarta vía sigue pasándolo ────────────────────────────────────────────────────
const v = c.validacion ?? {};
comprobar("la cuarta vía sigue midiéndose sobre una muestra seria (n ≥ 100)", (v.n ?? 0) >= 100, `n=${v.n}`);
comprobar("su desvío mediano sigue por debajo del listón", v.medianaAbs != null && v.medianaAbs < LISTON_DESVIO, `${v.medianaAbs} %`);
comprobar("su dispersión sectorial sigue por debajo del listón", v.dispersionSectorial != null && v.dispersionSectorial < LISTON_DISPERSION, `${v.dispersionSectorial} pp`);
comprobar("y el veredicto grabado es PASA", c.veredicto === "PASA", `es ${c.veredicto}`);
comprobar("rescata a alguien (si no, sobra)", (c.rescataria ?? 0) > 0, `${c.rescataria}`);

// ── 4. La vía pretax sigue RECHAZADA ────────────────────────────────────────────────────
const vp = p.resumen?.viaPretax ?? {};
comprobar("la vía pretax sigue incumpliendo el desvío", (vp.medianaAbs ?? 0) >= LISTON_DESVIO, `${vp.medianaAbs} %`);
comprobar("la vía pretax sigue incumpliendo la dispersión", (vp.dispersionSectorial ?? 0) >= LISTON_DISPERSION, `${vp.dispersionSectorial} pp`);

// ── 5. El código: la cuarta vía va la ÚLTIMA, y exige mismo cierre ───────────────────────
const src = readFileSync(EDGAR, "utf8");
comprobar("el tag CostsAndExpenses está declarado", /const CYE = \["CostsAndExpenses"\]/.test(src));
comprobar("la cuarta vía sólo actúa si no hay resultado de explotación", /if \(oi == null && rev != null/.test(src));
comprobar("y exige que los sumandos sean del MISMO cierre", /cye\.latestEnd === rev\.latestEnd/.test(src));
comprobar("deja procedencia grabada, no rellena en silencio", /oiFuente = "ingresos-menos-costes-y-gastos"/.test(src));
// El orden importa: si la cuarta se evaluara ANTES que el tag directo, sustituiría un dato
// bueno por uno reconstruido en las empresas que sí publican el resultado de explotación.
comprobar("el tag directo se sigue evaluando ANTES que cualquier reconstrucción",
  src.indexOf('let oi = F(T(OI, "OI"))') < src.indexOf('const cye = F(T(CYE, "CYE"))'));

// ── CONTROL POSITIVO ────────────────────────────────────────────────────────────────────
// Si el listón se relajara a 40 pp, la vía pretax pasaría. Esto lo demuestra: es exactamente
// el fallo que esta guarda existe para impedir.
const conListonFlojo = (vp.medianaAbs ?? 0) < 10 && (vp.dispersionSectorial ?? 0) < 40;
comprobar("CONTROL POSITIVO · con un listón relajado la vía RECHAZADA pasaría — por eso se vigila el listón", conListonFlojo);
comprobar("CONTROL POSITIVO · y con el listón real no pasa", !((vp.medianaAbs ?? 0) < LISTON_DESVIO && (vp.dispersionSectorial ?? 0) < LISTON_DISPERSION));

console.log(`\n  ${ok} comprobaciones OK${fallos ? ` · ${fallos} FALLOS` : ""}\n`);
process.exit(fallos ? 1 : 0);
