// La copia de Supabase a Cloud SQL (scripts/migrar_supabase.mjs), contra Postgres real y con
// la API de Supabase simulada.
//   PGHOST=127.0.0.1 PGPORT=5544 node --experimental-strip-types --no-warnings scripts/migrarsupabase.test.mjs
//
// Lo que esta prueba fija, porque cada punto falló o pudo fallar de verdad al preparar la copia:
//   · con offset, kb_chunks (51 000 filas) agotaba el tiempo de Supabase: paginar por clave;
//   · varias tablas tienen `id` identity ALWAYS y rechazaban el id copiado;
//   · kb_chunks.tsv es generada y no se puede insertar;
//   · tras copiar ids, la secuencia tiene que quedar por encima (o el siguiente insert choca);
//   · "Cloud SQL manda" no pisa, "Supabase manda" sí, y --sin-pisar no pisa nunca;
//   · leer menos filas de las que Supabase dice tener, o que falte una columna, PARA la copia.
import pg from "pg";

const host = process.env.PGHOST || "/tmp/scpg";
const port = Number(process.env.PGPORT || 5544);
const probe = new pg.Client({ host, port, user: "postgres", database: "scora" });
try { await probe.connect(); await probe.end(); }
catch {
  console.log(`\n○ migrarsupabase: SALTADO — no hay Postgres en ${host}:${port}`);
  process.exit(0);
}
process.env.SUPABASE_SERVICE_KEY = "clave-falsa";

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};

// ── Supabase simulado: tablas en memoria, con la semántica de PostgREST que usa el script ──
let ORIGEN = {};
let mentirEnElRecuento = false;
const peticiones = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const tabla = u.pathname.replace("/rest/v1/", "").replace(/\/$/, "");
  peticiones.push(u.search);
  if (tabla === "") {
    const definitions = Object.fromEntries(Object.entries(ORIGEN).map(([t, { cols }]) =>
      [t, { properties: Object.fromEntries(cols.map((c) => [c, {}])) }]));
    return new Response(JSON.stringify({ definitions }), { status: 200 });
  }
  const t = ORIGEN[tabla] ?? { cols: [], filas: [] };
  let filas = [...t.filas];
  const p = u.searchParams;
  for (const [k, v] of p) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    if (v === "is.null") filas = filas.filter((f) => f[k] == null);
    else if (v.startsWith("gt.")) filas = filas.filter((f) => String(f[k]).localeCompare(v.slice(3), undefined, { numeric: true }) > 0);
  }
  if (init.headers?.Prefer === "count=exact") {
    const n = filas.length + (mentirEnElRecuento ? 1 : 0);
    return new Response("[]", { status: 200, headers: { "content-range": `0-0/${n}` } });
  }
  if (p.has("offset")) filas = filas.slice(Number(p.get("offset")));
  filas = filas.slice(0, Number(p.get("limit") || 1000));
  const sel = (p.get("select") || "*").split(",");
  return new Response(JSON.stringify(filas.map((f) => sel[0] === "*" ? f : Object.fromEntries(sel.map((c) => [c, f[c] ?? null])))), { status: 200 });
};

const { pool } = await import("../lib/server/data/pool.ts");
const { migrar, PLAN } = await import("./migrar_supabase.mjs");
const db = pool();
// La prueba necesita las migraciones que la copia da por aplicadas; son idempotentes.
const { readFileSync } = await import("node:fs");
for (const f of ["004_smart_money_13f.sql", "005_desfases_research.sql"]) {
  await db.query(readFileSync(new URL(`../sql/gcp/${f}`, import.meta.url), "utf8"));
}
const tablas = Object.keys(PLAN);
const limpiar = () => db.query(`truncate ${tablas.map((t) => `public."${t}"`).join(", ")}`);

// Todas las tablas del plan existen en origen (vacías salvo las que prueban algo).
const columnasDe = async (t) => (await db.query(
  "select column_name from information_schema.columns where table_schema='public' and table_name=$1 and is_generated <> 'ALWAYS'", [t])).rows.map((r) => r.column_name)
  .filter((c) => !(t === "sl_paper_fund_track" && c.startsWith("coste_")));  // lo que solo tiene Cloud SQL
const base = {};
for (const t of tablas) base[t] = { cols: await columnasDe(t), filas: [] };

const correr = async (opciones = {}) => {
  const c = await db.connect();
  try {
    await c.query("begin");
    const informe = await migrar({ db: c, log: () => {}, ...opciones });
    await c.query("commit");
    return { informe };
  } catch (e) { await c.query("rollback"); return { error: e.message }; }
  finally { c.release(); }
};

// Supabase siempre devuelve las columnas NOT NULL rellenas (con su valor por defecto de allí).
// El simulador hace lo mismo, o el insert explícito de un null chocaría donde en real no choca.
const RELLENO = { created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", score_version: 1, form: "10-K", feed: "sp500" };
const completar = (filas) => filas.map((f) => ({ ...RELLENO, ...f }));

// ── 1. Una copia completa ────────────────────────────────────────────────────────────
await limpiar();
ORIGEN = structuredClone(base);
ORIGEN.sl_cohort.filas = completar(Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, score_date: "2026-01-01", ticker: `T${i + 1}` })));
ORIGEN.kb_chunks.filas = completar([{ id: "AAPL-1", ticker: "AAPL", section: "1A", text: "risk factors supply chain", chunk_idx: 0 }]);
ORIGEN.macro_state_history.filas = completar([{ snapshot_date: "2026-09-01", regime_id: "vieja" }, { snapshot_date: "2026-09-02", regime_id: "expansion" }]);
ORIGEN.sl_discovery.filas = completar([{ ticker: "NVDA", score: 90 }]);
ORIGEN.alerts_log.filas = [{ id: 1, alert_type: "sistema", user_id: null }, { id: 2, alert_type: "de un usuario", user_id: "uuid-de-supabase" }];
await db.query("insert into macro_state_history (snapshot_date, regime_id) values ('2026-09-01', 'nueva')");
await db.query("insert into sl_discovery (ticker, score) values ('NVDA', 10)");
peticiones.length = 0;
{
  const { error } = await correr();
  check("la copia termina sin error", error ?? null, null);
  check("2 500 filas de sl_cohort, todas", (await db.query("select count(*)::int n from sl_cohort")).rows[0].n, 2500);
  // sl_revisions tiene clave compuesta y sí va por offset (es pequeña); las de clave simple, no.
  check("con clave simple se pagina por clave, no por offset", peticiones.some((q) => q.includes("offset=") && !q.includes("snap_date")), false);
  check("y sl_cohort pidió 3 páginas encadenadas por id", peticiones.filter((q) => q.includes("score_date") && q.includes("order=id.asc")).length, 3);
  check("los ids de Supabase se conservan (identity ALWAYS)", (await db.query("select max(id)::int m from sl_cohort")).rows[0].m, 2500);
  check("la secuencia queda por encima: el siguiente insert no choca",
    (await db.query("insert into sl_cohort (score_date, ticker) values ('2030-01-01','NUEVO') returning id::int")).rows[0].id, 2501);
  check("kb_chunks.tsv se genera sola", (await db.query("select tsv is not null t from kb_chunks")).rows[0].t, true);
  check("Cloud SQL manda: su fila no se pisa", (await db.query("select regime_id from macro_state_history where snapshot_date='2026-09-01'")).rows[0].regime_id, "nueva");
  check("y la que faltaba entra", (await db.query("select count(*)::int n from macro_state_history")).rows[0].n, 2);
  check("Supabase manda: su fila sustituye a la vieja", Number((await db.query("select score from sl_discovery where ticker='NVDA'")).rows[0].score), 90);
  check("de alerts_log entran solo las de sistema", (await db.query("select alert_type from alerts_log")).rows.map((r) => r.alert_type), ["sistema"]);
}

// ── 2. Idempotente, y --sin-pisar no pisa nunca ─────────────────────────────────────
{
  await correr();
  check("repetir la copia no duplica", (await db.query("select count(*)::int n from sl_cohort")).rows[0].n, 2501);
  await db.query("update sl_discovery set score = 55 where ticker = 'NVDA'");
  process.argv.push("--sin-pisar");
  const { migrar: migrarSinPisar } = await import(`./migrar_supabase.mjs?sin-pisar`);
  process.argv.pop();
  const c = await db.connect();
  await c.query("begin"); await migrarSinPisar({ db: c, log: () => {} }); await c.query("commit"); c.release();
  check("--sin-pisar: la fila escrita en Cloud SQL se conserva", Number((await db.query("select score from sl_discovery where ticker='NVDA'")).rows[0].score), 55);
}

// ── 3. Lo que tiene que PARAR la copia (y no dejar nada a medias) ───────────────────
{
  await limpiar();
  ORIGEN = structuredClone(base);
  ORIGEN.sl_discovery.filas = completar([{ ticker: "NVDA", score: 90 }]);
  mentirEnElRecuento = true;
  const { error } = await correr();
  mentirEnElRecuento = false;
  check("leer menos filas de las que Supabase dice tener → error", /dice \d+ filas y se leyeron/.test(error ?? ""), true);
  check("y la transacción no deja nada", (await db.query("select count(*)::int n from sl_discovery")).rows[0].n, 0);

  ORIGEN = structuredClone(base);
  ORIGEN.sl_discovery.cols.push("columna_nueva_en_supabase");
  const r2 = await correr();
  check("una columna que Supabase tiene y Cloud SQL no → error, no se pierde en silencio",
    /no tiene columna_nueva_en_supabase/.test(r2.error ?? ""), true);
}

await limpiar();
await db.end();
console.log(bad ? `\n✗ migrarsupabase: ${bad} fallo(s) de ${total}` : `\n✓ migrarsupabase: ${total} comprobaciones OK contra Postgres real`);
process.exit(bad ? 1 : 0);
