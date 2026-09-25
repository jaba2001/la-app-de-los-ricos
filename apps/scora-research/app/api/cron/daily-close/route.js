// Cron: informe de cierre diario (TANDA S-B).
//
// Lee el macro_state más reciente (y el anterior, para detectar cambio de régimen),
// cotiza SPY + los 11 SPDR sectoriales, construye el informe DETERMINISTAMENTE con
// lib/dailyClose.js y lo guarda en sl_daily_close.
//
// Sin LLM, por la misma razón que lib/brief.js: el gate de grounding vive en el otro
// repositorio, así que aquí no puede haber un modelo capaz de inventar una cifra. El
// informe es plantilla sobre valores medidos, y los huecos se declaran (`gaps`) en vez de
// rellenarse.
//
// Coste: 12 peticiones al día a la API chart de Yahoo (gratis, sin clave). Ninguna a FMP —
// su plan aquí no cubre ETFs; ver `fetchQuotes`.
// Env: CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY.
import { assertCron, pgv } from '../../../../lib/server/cron.js';
import { buildDailyClose, SECTOR_UNIVERSE, parseYahooQuote } from '../../../../lib/server/dailyClose.js';
import { sbFetch } from "../../../../lib/server/data/postgrest.js";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const sbHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Yahoo bloquea las peticiones sin User-Agent de navegador; lib/macro.js hace lo mismo.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

/**
 * Cotizaciones de los 12 símbolos, una petición por símbolo, en paralelo.
 *
 * NO se usa FMP aquí: verificado contra la API real el 18-08-2026, el plan de este
 * proyecto **no cubre ETFs** — XLK, XLF, GLD y QQQ devuelven HTTP 402 tanto en
 * `/stable/quote` como en `/stable/historical-price-eod` (SPY y las acciones sí pasan), y
 * la forma batch `?symbol=A,B,C` devuelve 402 siempre. Un informe sin los 11 sectoriales
 * pierde justo la parte que lo diferencia. Ver `parseYahooQuote` en lib/dailyClose.js.
 *
 * Cada símbolo degrada por separado: el que falle queda a null y el informe lo declara en
 * `gaps` en vez de inventarlo.
 */
async function fetchQuotes(symbols) {
  const out = {};
  const dates = [];
  await Promise.all(symbols.map(async (sym) => {
    out[sym] = null;
    try {
      const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`;
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!r.ok) return;
      const q = parseYahooQuote(await r.json());
      if (q) { out[sym] = q.pct; if (q.asOf) dates.push(q.asOf); }
    } catch { /* este símbolo queda a null; el informe lo declara */ }
  }));
  // La fecha del propio dato manda sobre el reloj del servidor: si el cron se dispara en
  // un festivo, el informe se fecha en la última sesión real en vez de inventar un día.
  dates.sort();
  return { quotes: out, asOf: dates.length ? dates[dates.length - 1] : null };
}

export async function GET(request) {
  const denied = assertCron(request); if (denied) return denied;
  if (!SB || !KEY) return json({ error: 'Supabase not configured' }, 500);
  // Sin guarda de FMP_KEY: este cron ya no la usa, y abortar por una variable que no
  // necesita lo dejaría muerto por una razón falsa.

  // 1 · los dos snapshots macro más recientes (el previo detecta el cambio de régimen)
  const mRes = await sbFetch(`macro_state?select=*&order=snapshot_date.desc&limit=2`, { headers: sbHeaders });
  const mRows = mRes.ok ? await mRes.json().catch(() => []) : [];
  const macro = Array.isArray(mRows) && mRows[0] ? mRows[0] : null;
  const prevMacro = Array.isArray(mRows) && mRows[1] ? mRows[1] : null;

  // 2 · índice + sectores
  const symbols = ['SPY', ...SECTOR_UNIVERSE.map((s) => s.etf)];
  const { quotes, asOf } = await fetchQuotes(symbols);
  const sectors = SECTOR_UNIVERSE.map((s) => ({ ...s, changePct: quotes[s.etf] ?? null }));
  const spy = quotes.SPY != null ? { changePct: quotes.SPY } : null;

  // 3 · construir. La fecha sale del propio dato de mercado; si no hay, del snapshot macro;
  // y como último recurso, del reloj. Fechar el informe por el reloj cuando el mercado no
  // ha abierto crearía una fila para un día que no existió.
  const date = (asOf || (macro && macro.snapshot_date ? String(macro.snapshot_date) : new Date().toISOString())).slice(0, 10);
  const report = buildDailyClose({ macro, prevMacro, spy, sectors, date });

  // Un informe sin NADA medido no se publica: sería una página con la marca Scora que no
  // dice nada comprobable. Mejor no escribir fila y que el cron lo reporte.
  if (report.gaps.length >= 3) {
    return json({ ok: false, reason: 'no measurable data', gaps: report.gaps, date }, 503);
  }

  // 4 · upsert idempotente por día — re-ejecutar el cron no duplica ni rompe.
  const up = await sbFetch(`sl_daily_close?on_conflict=close_date`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ close_date: date, payload: report, updated_at: new Date().toISOString() }),
  });
  if (!up.ok) {
    const detail = await up.text().catch(() => '');
    return json({ error: 'sl_daily_close write failed', status: up.status, detail: detail.slice(0, 300) }, 502);
  }

  return json({
    ok: true,
    date,
    regimeChanged: report.regime.changed,
    breadth: report.breadth ? report.breadth.kind : null,
    sectorsPriced: sectors.filter((s) => s.changePct != null).length,
    gaps: report.gaps,
  });
}
