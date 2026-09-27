// Copia los datos de Supabase a Cloud SQL (AUDIT_REPORT C-5). Idempotente.
//
//   SUPABASE_SERVICE_KEY=… PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGPASSWORD=… PGDATABASE=scora \
//     node --experimental-strip-types --no-warnings scripts/migrar_supabase.mjs [--dry-run] [--sin-pisar] [--solo=t1,t2]
//
//   --dry-run    solo lee y cuenta; la transacción se deshace al final.
//   --sin-pisar  ninguna fila existente se toca, en ninguna tabla: solo entra lo que falta.
//
// ORDEN: 1) esta copia, sin flags (Supabase manda en las tablas de los workflows);
//        2) activar los workflows contra Cloud SQL.
// Si hay que volver a lanzarla DESPUÉS del paso 2, con --sin-pisar: sin él, las filas que los
// workflows ya escribieron en Cloud SQL se sustituirían por las más viejas de Supabase.
//
// QUÉ SE COPIA Y CÓMO. Cada tabla tiene un dueño, y eso decide qué pasa si la fila ya existe:
//
//   · SUPABASE MANDA (`actualizar`): las tablas que solo escriben los workflows de GitHub. Hasta
//     el cambio, lo bueno está en Supabase; Cloud SQL, si tiene algo, es una copia vieja.
//   · CLOUD SQL MANDA (`rellenar`): las que ya escriben los crons de Cloud Run. Lo que haya en
//     Cloud SQL es más nuevo y NO se pisa; de Supabase solo entran las filas que faltan (p. ej.
//     el histórico anterior a la migración).
//   · DE USUARIO: NO se copian. Sus user_id son uuids de Supabase Auth, que no existen en
//     Identity Platform: serían filas huérfanas con datos personales que nadie podría ver ni
//     borrar. De alerts_log sí entran las alertas de sistema (user_id nulo).
//
// Las tablas ic_* y api_calls_log de Supabase son del proyecto ic-proxy: fuera de alcance.

import pg from "pg";

const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const SECO = process.argv.includes("--dry-run");
const SIN_PISAR = process.argv.includes("--sin-pisar");
const SOLO = process.argv.find((a) => a.startsWith("--solo="))?.slice(7).split(",") ?? null;
const PAGINA = 1000;

/** tabla → [modo, filtro PostgREST opcional]. El orden no importa: no hay claves ajenas. */
export const PLAN = {
  // Supabase manda: las escriben solo los workflows.
  sl_revisions:        ["actualizar"],
  sl_cohort:           ["actualizar"],
  sl_track_summary:    ["actualizar"],
  sl_discovery:        ["actualizar"],
  sl_paper_fund:       ["actualizar"],
  sl_paper_fund_track: ["actualizar"],
  sl_picks_run:        ["actualizar"],
  sl_picks_position:   ["actualizar"],
  kb_docs:             ["actualizar"],
  kb_chunks:           ["actualizar"],
  kb_cards:            ["actualizar"],
  // Cloud SQL manda: ya las escribe Cloud Run.
  macro_state:            ["rellenar"],
  macro_state_history:    ["rellenar"],
  sl_daily_close:         ["rellenar"],
  sl_briefings:           ["rellenar"],
  smart_money_top_buyers: ["rellenar"],
  smart_money_13f:        ["rellenar"],
  push_alert_state:       ["rellenar"],
  alerts_log:             ["rellenar", "user_id=is.null"],
};

/** Las que se dejan fuera a propósito, para que el informe final las nombre. */
export const DE_USUARIO = [
  "ai_audit_log", "ic_briefs", "push_subscriptions", "sl_alert_prefs", "sl_alerts", "sl_analyses",
  "sl_journal", "sl_score_log", "sl_subscriptions", "sl_waitlist", "sl_watchlist", "stock_snapshot",
  "sl_stripe_events",
];

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`supabase ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
}

async function contarEnSupabase(tabla, filtro) {
  const r = await sb(`${tabla}?select=*&limit=1${filtro ? `&${filtro}` : ""}`, { headers: { Prefer: "count=exact" } });
  return Number(r.headers.get("content-range")?.split("/")[1] ?? NaN);
}

/** Las columnas de cada tabla en Supabase, según la definición que publica su API. */
let _enSupabase = null;
async function columnasEnSupabase(tabla) {
  _enSupabase ??= (await (await sb("")).json()).definitions ?? {};
  const def = _enSupabase[tabla];
  if (!def) throw new Error(`${tabla}: no existe en Supabase`);
  return new Set(Object.keys(def.properties ?? {}));
}

/** Columnas a copiar: las de DESTINO que también existen en Supabase. Las generadas
 *  (kb_chunks.tsv) no se insertan, y las que solo tiene Cloud SQL (005_desfases_research.sql)
 *  se quedan con su valor por defecto: pedírselas a Supabase daba 400. */
async function columnas(db, tabla) {
  const { rows } = await db.query(
    `select column_name, is_generated from information_schema.columns
      where table_schema = 'public' and table_name = $1 order by ordinal_position`, [tabla]);
  if (!rows.length) throw new Error(`${tabla}: no existe en Cloud SQL (¿falta aplicar una migración?)`);
  const origen = await columnasEnSupabase(tabla);
  const faltan = [...origen].filter((c) => !rows.some((r) => r.column_name === c));
  // Una columna que Supabase tiene y Cloud SQL no es un dato que se perdería: se para.
  if (faltan.length) throw new Error(`${tabla}: Cloud SQL no tiene ${faltan.join(", ")} (¿falta una migración?)`);
  return rows.filter((r) => r.is_generated !== "ALWAYS" && origen.has(r.column_name)).map((r) => r.column_name);
}

async function clavePrimaria(db, tabla) {
  const { rows } = await db.query(
    `select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = $1::regclass and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)`,
    [`public.${tabla}`]);
  return rows.map((r) => r.attname);
}

const q = (id) => `"${id.replace(/"/g, '""')}"`;

/** Una página de Supabase → Cloud SQL. json_populate_recordset hace la conversión de tipos
 *  (jsonb, arrays, fechas) con las reglas de Postgres, en vez de adivinarla aquí. */
async function escribir(db, tabla, cols, pk, modo, filas) {
  const lista = cols.map(q).join(", ");
  const conflicto = modo === "actualizar"
    ? `do update set ${cols.filter((c) => !pk.includes(c)).map((c) => `${q(c)} = excluded.${q(c)}`).join(", ") || `${q(pk[0])} = excluded.${q(pk[0])}`}`
    : "do nothing";
  const r = await db.query(
    // OVERRIDING SYSTEM VALUE: varias tablas tienen `id` identity ALWAYS y rechazan un id
    // explícito. Se conservan los de Supabase (las referencias entre filas dependen de ellos);
    // en tablas sin identity no tiene efecto.
    `insert into public.${q(tabla)} (${lista}) overriding system value
     select ${lista} from json_populate_recordset(null::public.${q(tabla)}, $1::json)
     on conflict (${pk.map(q).join(", ")}) ${conflicto}`,
    [JSON.stringify(filas)]);
  return r.rowCount ?? 0;
}

/** Tras meter ids explícitos, la secuencia tiene que quedar por encima o el próximo insert
 *  de un cron chocaría con una fila copiada. */
async function ajustarSecuencias(db, tabla) {
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 and (column_default like 'nextval%' or is_identity = 'YES')`, [tabla]);
  for (const { column_name: c } of rows) {
    await db.query(
      `select setval(pg_get_serial_sequence($1, $2), greatest((select coalesce(max(${q(c)}), 0) from public.${q(tabla)}), 1))`,
      [`public.${tabla}`, c]);
  }
}

export async function migrar({ db, log = console.log }) {
  _enSupabase = null; // cada copia lee la definición de Supabase de nuevo
  const informe = [];
  for (const [tabla, [modoPlan, filtro]] of Object.entries(PLAN)) {
    if (SOLO && !SOLO.includes(tabla)) continue;
    const modo = SIN_PISAR ? "rellenar" : modoPlan;
    const enSupabase = await contarEnSupabase(tabla, filtro);
    const cols = await columnas(db, tabla);
    const pk = await clavePrimaria(db, tabla);
    const antes = Number((await db.query(`select count(*) n from public.${q(tabla)}`)).rows[0].n);
    let leidas = 0, escritas = 0;
    // Página a página y ordenado por la clave. Con clave simple, por rango (`id > último`): con
    // offset, kb_chunks (51 000 filas) agotaba el tiempo de consulta de Supabase hacia la página
    // 17. Solo se piden las columnas que se insertan — tsv es generada y pesa.
    const orden = pk.map((c) => `${c}.asc`).join(",");
    const sel = cols.join(",");
    const simple = pk.length === 1;
    let ultimo = null;
    for (let desde = 0; ; desde += PAGINA) {
      const rango = simple ? (ultimo == null ? "" : `&${pk[0]}=gt.${encodeURIComponent(ultimo)}`) : `&offset=${desde}`;
      const r = await sb(`${tabla}?select=${sel}&order=${orden}&limit=${PAGINA}${rango}${filtro ? `&${filtro}` : ""}`);
      const filas = await r.json();
      if (!filas.length) break;
      leidas += filas.length;
      if (simple) ultimo = filas[filas.length - 1][pk[0]];
      if (!SECO) escritas += await escribir(db, tabla, cols, pk, modo, filas);
      if (filas.length < PAGINA) break;
    }
    if (!SECO) await ajustarSecuencias(db, tabla);
    const despues = Number((await db.query(`select count(*) n from public.${q(tabla)}`)).rows[0].n);
    const fila = { tabla, modo, enSupabase, leidas, antes, escritas, despues };
    informe.push(fila);
    log(`${tabla.padEnd(24)} ${modo.padEnd(10)} supabase ${String(enSupabase).padStart(6)} · leídas ${String(leidas).padStart(6)} · cloud sql ${String(antes).padStart(6)} → ${String(despues).padStart(6)}${SECO ? "  (seco)" : ""}`);
    // Leer menos de lo que Supabase dice tener es perder filas en silencio: se para aquí.
    if (leidas !== enSupabase) throw new Error(`${tabla}: Supabase dice ${enSupabase} filas y se leyeron ${leidas}`);
  }
  return informe;
}

// Solo cuando se ejecuta directamente (la prueba importa PLAN y migrar).
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!SB_KEY) { console.error("Falta SUPABASE_SERVICE_KEY"); process.exit(1); }
  const db = new pg.Client({
    host: process.env.PGHOST || "127.0.0.1", port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres", password: process.env.PGPASSWORD, database: process.env.PGDATABASE || "scora",
  });
  await db.connect();
  console.log(`${SECO ? "SIMULACIÓN (no escribe)" : "COPIANDO"}${SIN_PISAR ? " sin pisar filas existentes" : ""} · ${SB_URL} → ${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || "scora"}\n`);
  try {
    await db.query("begin");
    await migrar({ db });
    // Todo o nada: una copia a medias deja tablas de un sistema y de otro mezcladas.
    await db.query(SECO ? "rollback" : "commit");
    console.log(`\nNo se copian (datos de usuarios de Supabase Auth, sin equivalente en Identity Platform): ${DE_USUARIO.join(", ")}`);
  } catch (e) {
    await db.query("rollback").catch(() => {});
    console.error(`\nERROR — no se ha escrito nada: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}
