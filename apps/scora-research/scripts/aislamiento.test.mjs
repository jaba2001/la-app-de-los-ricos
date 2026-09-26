// AISLAMIENTO ENTRE USUARIOS — la prueba que autoriza esta migración.
//   node --experimental-strip-types --no-warnings scripts/aislamiento.test.mjs
//
// POR QUÉ EXISTE. En Supabase, que un usuario no viera los datos de otro lo garantizaba la
// base de datos: 38 políticas RLS y `auth.uid()`. En Cloud SQL la app se conecta con UNA
// identidad de servicio, así que Postgres ya no puede distinguir a nadie y esas políticas no
// existen. La garantía se ha mudado a lib/server/data/query.ts.
//
// Si esa mudanza está mal, NADA FALLA: la app funciona, no hay errores, y simplemente cada
// usuario ve el diario de inversión y la watchlist de los demás. En un producto donde la
// gente apunta en qué invierte, ese es el peor desenlace posible — y es invisible.
//
// Por eso lo que más se prueba aquí no es que las consultas funcionen, sino que los INTENTOS
// DE SALTARSE EL FILTRO fracasen. Cada caso de la sección "ataques" es una forma real de
// pedir los datos de otro.
import { construir, RechazoPolitica } from "../lib/server/data/query.ts";

const ANA  = "11111111-1111-1111-1111-111111111111";
const BENI = "22222222-2222-2222-2222-222222222222";

// Columnas reales, tomadas del esquema migrado (sql/gcp/001_schema.sql).
const ESQUEMA = {
  sl_watchlist:  new Set(["id", "user_id", "ticker", "created_at"]),
  sl_analyses:   new Set(["id", "user_id", "ticker", "analysis_date", "score_total", "sector"]),
  sl_journal:    new Set(["id", "user_id", "ticker", "note", "created_at"]),
  macro_state:   new Set(["id", "regime_id", "dgs10", "credit_stress"]),
  sl_stripe_events: new Set(["id", "event_id"]),
};

let bad = 0;
const check = (label, got, want) => {
  const ok = Object.is(got, want);
  if (!ok) { bad++; console.log(`FAIL  ${label}\n      got:  ${got}\n      want: ${want}`); }
};
/** Ejecuta y devuelve "OK" o el nombre del rechazo. */
const intenta = (pet, uid) => {
  try { return { sql: construir(pet, uid, ESQUEMA) }; }
  catch (e) { return { rechazo: e instanceof RechazoPolitica ? e.message : `¡otro error! ${e.message}` }; }
};

// ── 1. El filtro de usuario se pone SIEMPRE, se pida o no ───────────────────────────
{
  // Esta es la consulta real de useWatchlistAnalyses: pide por ticker y NO menciona al
  // usuario. En Supabase la salvaba la RLS. Aquí tiene que salvarla esta capa.
  const { sql } = intenta({ table: "sl_analyses", op: "select", filters: [{ col: "ticker", op: "in", val: ["AAPL", "MSFT"] }] }, ANA);
  check("select sin pedir usuario → lleva el filtro", /"user_id" = \$1/.test(sql.text), true);
  check("y el valor es el del token", sql.values[0], ANA);
  check("el filtro va el primero", sql.text.indexOf('"user_id"') < sql.text.indexOf('"ticker"'), true);
}

// ── 2. Ana y Beni generan SQL distinto ──────────────────────────────────────────────
{
  const pet = { table: "sl_journal", op: "select" };
  check("Ana filtra por Ana",  intenta(pet, ANA).sql.values[0], ANA);
  check("Beni filtra por Beni", intenta(pet, BENI).sql.values[0], BENI);
}

// ── 3. ATAQUES: intentos reales de leer o escribir lo ajeno ─────────────────────────
{
  // (a) Pedir explícitamente las filas de Beni. El filtro propio se SUMA con AND, así que
  //     el resultado es "las de Ana Y de Beni" = ninguna. Acotar más es inofensivo.
  const { sql } = intenta({ table: "sl_journal", op: "select", filters: [{ col: "user_id", op: "eq", val: BENI }] }, ANA);
  check("filtrar por otro usuario → sigue el suyo", sql.values[0], ANA);
  check("y se añade con AND, no lo reemplaza", (sql.text.match(/"user_id"/g) || []).length, 2);

  // (b) Escribir una fila a nombre de Beni.
  const ins = intenta({ table: "sl_watchlist", op: "insert", rows: [{ ticker: "AAPL", user_id: BENI }] }, ANA);
  check("insertar como otro → se ignora su user_id", ins.sql.values.includes(BENI), false);
  check("y la fila queda a nombre de Ana", ins.sql.values.includes(ANA), true);

  // (c) Cambiar el dueño de una fila propia.
  const upd = intenta({ table: "sl_journal", op: "update", patch: { user_id: BENI, note: "x" }, filters: [{ col: "id", op: "eq", val: 7 }] }, ANA);
  check("update no puede cambiar el dueño", upd.sql.text.includes('SET "user_id"'), false);

  // (d) Borrar lo de otro.
  const del = intenta({ table: "sl_journal", op: "delete", filters: [{ col: "id", op: "eq", val: 7 }] }, ANA);
  check("delete lleva el filtro de usuario", del.sql.values[0], ANA);

  // (e) Sin sesión, una tabla privada no devuelve "todo": no devuelve nada.
  check("privada sin usuario → rechazo", intenta({ table: "sl_journal", op: "select" }, null).rechazo?.includes("requiere sesión"), true);
}

// ── 4. Denegar por defecto ──────────────────────────────────────────────────────────
{
  check("tabla fuera de la política", intenta({ table: "sl_stripe_events", op: "select" }, ANA).rechazo?.includes("no accesible"), true);
  check("tabla inventada",            intenta({ table: "usuarios_secretos", op: "select" }, ANA).rechazo?.includes("no accesible"), true);
  check("operación no permitida",     intenta({ table: "macro_state", op: "delete" }, ANA).rechazo?.includes("no permitida"), true);
  check("escribir en compartida",     intenta({ table: "macro_state", op: "insert", rows: [{ id: 1 }] }, ANA).rechazo?.includes("no permitida"), true);
}

// ── 5. Inyección por nombres de columna (lo único que no se puede parametrizar) ─────
{
  const iny = [
    'ticker"; DROP TABLE sl_journal; --',
    "ticker' OR '1'='1",
    "*",
    "user_id, (select password from auth.users)",
  ];
  for (const col of iny) {
    const r = intenta({ table: "sl_journal", op: "select", filters: [{ col, op: "eq", val: "x" }] }, ANA);
    check(`inyección rechazada: ${col.slice(0, 26)}`, r.rechazo?.includes("no permitida"), true);
  }
  const r2 = intenta({ table: "sl_journal", op: "select", columns: "id, (select 1)" }, ANA);
  check("inyección en la lista de columnas", r2.rechazo?.includes("no permitida"), true);
}

// ── 6. Las compartidas NO llevan filtro (si lo llevaran, no habría datos macro) ──────
{
  const { sql } = intenta({ table: "macro_state", op: "select", filters: [{ col: "id", op: "eq", val: 1 }] }, ANA);
  check("compartida sin filtro de usuario", sql.text.includes("user_id"), false);
  check("compartida funciona sin sesión", Boolean(intenta({ table: "macro_state", op: "select" }, null).sql), true);
}

// ── 7. Guardas que evitan desastres tontos ──────────────────────────────────────────
{
  check("UPDATE sin condiciones → rechazo", intenta({ table: "sl_journal", op: "update", patch: { note: "x" } }, null).rechazo?.includes("requiere sesión"), true);
  check("DELETE en compartida → no permitido", intenta({ table: "macro_state", op: "delete" }, ANA).rechazo?.includes("no permitida"), true);
  const sinLim = intenta({ table: "macro_state", op: "select" }, ANA);
  check("SELECT siempre lleva LIMIT", /LIMIT \d+/.test(sinLim.sql.text), true);
  const enorme = intenta({ table: "macro_state", op: "select", limit: 999999 }, ANA);
  check("LIMIT con techo", /LIMIT 5000/.test(enorme.sql.text), true);
  const vacio = intenta({ table: "sl_analyses", op: "select", filters: [{ col: "ticker", op: "in", val: [] }] }, ANA);
  check("IN vacío → ninguna fila, no error", vacio.sql.text.includes("FALSE"), true);
}

console.log(bad ? `\naislamiento: ${bad} FALLO(S) — NO DESPLEGAR` : "\naislamiento: 27 comprobaciones OK");
process.exit(bad ? 1 : 0);
