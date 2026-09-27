// Los numeric de Postgres tienen que llegar a la interfaz como NUMEROS.
//
// node-pg los devuelve como cadena para no perder precision. PostgREST, que es lo que
// habia con Supabase, los serializaba como numero JSON. Al sustituirlo, cada
// `v.toFixed(1)` de las vistas empezo a recibir una cadena y reventaba la pagina entera
// con "toFixed is not a function" — /macro, /discovery y /momentum, para cualquier
// usuario con sesion. Este test existe para que no vuelva a pasar en silencio.
//
// Se prueba contra Postgres de verdad: el fallo esta en los METADATOS de tipo que
// devuelve el driver, asi que un mock de las filas no lo detectaria — de hecho no lo
// detecto, y por eso el fallo llego a la pantalla dos veces.
import pg from "pg";

const host = process.env.PGHOST || "/tmp/scpg";
const port = Number(process.env.PGPORT || 5544);
const probe = new pg.Client({ host, port, user: "postgres", database: "scora" });
try { await probe.connect(); }
catch { console.log(`\n○ numeros: SALTADO — no hay Postgres en ${host}:${port}`); process.exit(0); }

const { filasConNumeros } = await import("../lib/server/data/numeros.js");

let mal = 0;
const comprueba = (nombre, ok, detalle = "") => {
  if (ok) console.log(`  ✓ ${nombre}`);
  else { console.log(`  ✗ ${nombre}${detalle ? " — " + detalle : ""}`); mal++; }
};

console.log("\nnumeros — los numeric llegan como number");

// 1. El driver los da como cadena: si esto deja de cumplirse, este test sobra.
const crudo = await probe.query("select 1.5::numeric as a, 7::int8 as b, 'ABC'::text as t");
comprueba("node-pg devuelve numeric como cadena (premisa del test)",
  typeof crudo.rows[0].a === "string", `fue ${typeof crudo.rows[0].a}`);

// 2. La conversion arregla numeric e int8...
const conv = filasConNumeros(crudo)[0];
comprueba("numeric -> number", typeof conv.a === "number" && conv.a === 1.5, `fue ${typeof conv.a}`);
comprueba("int8 -> number", typeof conv.b === "number" && conv.b === 7, `fue ${typeof conv.b}`);

// 3. ...y NO toca el texto. Un ticker "123" tiene que seguir siendo cadena.
const txt = await probe.query("select '123'::text as ticker");
comprueba("texto numerico sigue siendo cadena",
  typeof filasConNumeros(txt)[0].ticker === "string");

// 4. El caso real que rompio la pantalla: las columnas que pinta /macro.
const macro = await probe.query(
  "select risk_on, liquidity_cycle, recession_prob, credit_stress, implied_corr from macro_state limit 1");
if (macro.rows.length) {
  const f = filasConNumeros(macro)[0];
  const malas = Object.entries(f).filter(([, v]) => v != null && typeof v !== "number").map(([k]) => k);
  comprueba("columnas de macro_state todas numericas", malas.length === 0, `cadenas: ${malas.join(", ")}`);
  // Lo que hace la vista y reventaba:
  let explota = null;
  try { for (const v of Object.values(f)) if (v != null) Number(v).toFixed(1); }
  catch (e) { explota = e.message; }
  comprueba("toFixed() sobre cada valor no lanza", explota === null, explota ?? "");
} else {
  console.log("  ○ macro_state vacia — se omiten las dos comprobaciones sobre datos reales");
}

// 5. Sin filas no debe explotar.
const vacio = await probe.query("select 1::numeric as a where false");
comprueba("resultado vacio devuelve []", Array.isArray(filasConNumeros(vacio)) && filasConNumeros(vacio).length === 0);

await probe.end();
console.log(mal ? `\n✗ numeros: ${mal} fallos` : "\n✓ numeros: todo correcto");
process.exit(mal ? 1 : 0);
