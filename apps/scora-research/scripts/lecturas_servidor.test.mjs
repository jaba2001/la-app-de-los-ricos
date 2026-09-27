// Las dos lecturas de servidor de las páginas públicas: /daily (lib/dailyClose.ts) y /picks
// (lib/picksData.ts), contra Postgres de verdad.
//   PGHOST=127.0.0.1 PGPORT=5544 node --experimental-strip-types --no-warnings scripts/lecturas_servidor.test.mjs
//
// POR QUÉ EXISTE (AUDIT_REPORT C-2): hasta el 27-09 las dos leían el REST de Supabase con
// NEXT_PUBLIC_SUPABASE_URL, que el build ya no recibía. No fallaba nada: devolvían null, la
// página pintaba "No close published yet" y en producción se veía exactamente eso, mientras el
// cron escribía el informe en Cloud SQL. Ninguna prueba leía de la base.
//
// Se SALTA sin Postgres, igual que postgrest.test.mjs.
import pg from "pg";

const host = process.env.PGHOST || "/tmp/scpg";
const port = Number(process.env.PGPORT || 5544);
const probe = new pg.Client({ host, port, user: "postgres", database: "scora" });
try { await probe.connect(); await probe.end(); }
catch { console.log(`\n○ lecturas_servidor: SALTADO — no hay Postgres en ${host}:${port}`); process.exit(0); }

process.env.PGHOST = host; process.env.PGPORT = String(port);
process.env.PGUSER = "postgres"; process.env.PGDATABASE = "scora";
// Sin estas variables es como corre producción: si algo siguiera leyendo de Supabase,
// devolvería vacío y la prueba lo cazaría.
delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const { pool } = await import("../lib/server/data/pool.ts");
const { fetchDailyClose, fetchDailyDates } = await import("../lib/dailyClose.ts");
const { fetchOpenPositions, fetchClosedPositions, fetchRuns } = await import("../lib/picksData.ts");
const { PICKS_RULES_VERSION: V } = await import("../lib/picks.ts");

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};

const p = pool();
await p.query("truncate sl_daily_close, sl_picks_position, sl_picks_run");

// ── /daily ──────────────────────────────────────────────────────────────────────────
check("sin informes → null, no revienta", await fetchDailyClose(), null);
check("sin informes → sin fechas", await fetchDailyDates(), []);

const informe = (d, spy) => ({ date: d, generatedAt: `${d}T21:00:00Z`, regime: { id: "expansion", previousId: "expansion", changed: false, confirmed: true },
  market: { spyChangePct: spy, vix: 15, hyOas: 300, dgs10: 4.1, riskOn: 60 }, breadth: null, sectors: [], leaders: [], laggards: [],
  headline: "h", context: "c", gaps: [] });
await p.query("insert into sl_daily_close (close_date, payload) values ($1, $2), ($3, $4)",
  ["2026-09-25", informe("2026-09-25", 0.5), "2026-09-26", informe("2026-09-26", -1.2)]);

check("el más reciente", (await fetchDailyClose())?.date, "2026-09-26");
check("uno concreto", (await fetchDailyClose("2026-09-25"))?.market.spyChangePct, 0.5);
check("un día sin informe → null", await fetchDailyClose("2026-01-01"), null);
// Las fechas alimentan el navegador de días y el sitemap, y pasan por isIsoDay: con el formato
// que daba node-pg antes de C-3 ("2026-09-26T00:00:00.000Z") se filtraban TODAS.
check("fechas, de la más reciente a la más antigua y como YYYY-MM-DD",
  await fetchDailyDates(), ["2026-09-26", "2026-09-25"]);

// ── /picks ──────────────────────────────────────────────────────────────────────────
check("sin posiciones → []", await fetchOpenPositions(), []);

await p.query(`insert into sl_picks_position (id, ticker, rules_version, opened_on, open_pctl, open_price, closed_on, close_price, close_reason) values
  (1, 'AAPL', $1, '2026-09-01', 0.91, 200, null, null, null),
  (2, 'MSFT', $1, '2026-08-15', 0.88, 400, '2026-09-15', 420, 'senal_bajo_umbral'),
  (3, 'OLD',  $2, '2026-08-01', 0.80, 10,  null, null, null)`, [V, V - 1]);
await p.query(`insert into sl_picks_run (id, decision_date, rules_version, universe_size, eligible_count, bought_count, sold_count, positions_after)
  values (1, '2026-09-15', $1, 500, 120, 0, 1, 1), (2, '2026-09-01', $1, 500, 118, 1, 0, 2)`, [V]);

const abiertas = await fetchOpenPositions();
check("abiertas: solo la versión de reglas vigente", abiertas.map((x) => x.ticker), ["AAPL"]);
check("abiertas: fecha como YYYY-MM-DD", abiertas[0]?.opened_on, "2026-09-01");
check("abiertas: numeric llega como número", typeof abiertas[0]?.open_pctl, "number");
// `closed_on=not.is.null`: la forma de PostgREST que sbFetch no entendía (C-2).
const cerradas = await fetchClosedPositions();
check("cerradas: not.is.null funciona", cerradas.map((x) => x.ticker), ["MSFT"]);
check("cerradas: fecha de cierre como YYYY-MM-DD", cerradas[0]?.closed_on, "2026-09-15");
check("decisiones, de la más reciente a la más antigua",
  (await fetchRuns()).map((r) => r.decision_date), ["2026-09-15", "2026-09-01"]);

await p.query("truncate sl_daily_close, sl_picks_position, sl_picks_run");
await p.end();
console.log(bad ? `\n✗ lecturas_servidor: ${bad} fallo(s) de ${total}` : `\n✓ lecturas_servidor: ${total} comprobaciones OK contra Postgres real`);
process.exit(bad ? 1 : 0);
