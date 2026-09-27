// El expediente publicado: lo único de la base que se sirve sin sesión.
//
// /api/data exige token para todo, y eso es correcto para el producto. Pero hay
// cuatro conjuntos que la propia landing anuncia y que el sitemap declara
// indexables (/track-record, /demo). Pedirlos por la puerta autenticada hacía dos
// cosas mal: /track-record necesitaba un guardia de login pese a estar en el
// sitemap, y /demo enseñaba "the live read isn't available" a todo visitante
// anónimo — no era un vacío de datos, era el 401.
//
// Esto NO es "abrir las tablas shared". `shared` significa "no es por usuario", no
// "es pública": kb_docs, sl_briefings o macro_state_history son producto de pago. Por eso
// aquí no se acepta ningún nombre de tabla del cliente: las consultas son fijas y
// están escritas a mano, una por conjunto publicado.
//
// NO PUEDE IR EN EDGE, por la misma razón que /api/data: el driver de Postgres
// necesita sockets de Node.
import { checkRateLimit, clientIp } from "../../../lib/server/ratelimit.js";
import { corsHeaders, preflight } from "../../../lib/server/cors.js";
import { pool } from "../../../lib/server/data/pool.ts";

// node-pg devuelve numeric/decimal e int8 como CADENA para no perder precision.
// Las paginas hacen v.toFixed(), asi que una cadena revienta la vista entera con
// "e.toFixed is not a function". Se convierte por OID —1700 numeric, 20 int8— y no
// adivinando por el aspecto del valor, que estropearia tickers o fechas.
const OID_NUMERICOS = new Set([1700, 20, 700, 701]);

function aNumeros(res: { rows: Record<string, unknown>[]; fields: { name: string; dataTypeID: number }[] }) {
  const fila = res.rows[0];
  if (!fila) return null;
  const cols = new Set(res.fields.filter(f => OID_NUMERICOS.has(f.dataTypeID)).map(f => f.name));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fila)) {
    out[k] = cols.has(k) && v != null ? Number(v) : v;
  }
  return out;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Sin usuario al que atribuir el gasto, el cupo va por IP.
  const rl = await checkRateLimit("publico", clientIp(request), 60, 60, request);
  if (rl) return rl;

  try {
    const db = pool();
    const [resumen, cohortes, track, cartera, macro] = await Promise.all([
      db.query("select * from sl_track_summary where id = 1 limit 1"),
      db.query("select count(*)::int as n from sl_cohort"),
      db.query("select * from sl_paper_fund_track order by as_of desc limit 1"),
      db.query("select * from sl_paper_fund order by rebalance_date desc limit 1"),
      // Solo la foto actual y solo las columnas que pinta /demo: el historico
      // (macro_state_history) y el resto del motor siguen tras el login. La propia
      // copia de /demo promete "the live read the app runs on, read-only".
      db.query(`select snapshot_date, risk_on, risk_on_lcc, risk_on_rpc, risk_on_csc,
                       liquidity_cycle, recession_prob, credit_stress,
                       breadth_200dma, breadth_50dma, breadth_1m, breadth_mom,
                       buffett_indicator, cape, expected_return_10y, implied_corr
                  from macro_state where id = 1 limit 1`),
    ]);

    return new Response(JSON.stringify({
      resumen:  aNumeros(resumen),
      cohortes: cohortes.rows[0]?.n ?? 0,
      track:    aNumeros(track),
      cartera:  aNumeros(cartera),
      macro:    aNumeros(macro),
    }), {
      status: 200,
      headers: corsHeaders(request, {
        "Content-Type": "application/json",
        // Es contenido publicado que cambia como mucho a diario.
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      }),
    });
  } catch (e) {
    console.error("[publico] fallo al leer el expediente", e);
    return new Response(JSON.stringify({ error: "no disponible" }), {
      status: 503,
      headers: corsHeaders(request, { "Content-Type": "application/json" }),
    });
  }
}

export async function OPTIONS(request: Request) {
  return preflight(request);
}
