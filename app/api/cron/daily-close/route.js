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
// Coste: 12 cotizaciones FMP al día. Nada más.
// Env: CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY, FMP_KEY.
import { assertCron, pgv } from '../../../../lib/cron.js';
import { buildDailyClose, SECTOR_UNIVERSE } from '../../../../lib/dailyClose.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const sbHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Cotización batch de FMP: un solo GET para los 12 símbolos. */
async function fetchQuotes(symbols) {
  const out = {};
  try {
    const u = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbols.join(','))}&apikey=${process.env.FMP_KEY}`;
    const r = await fetch(u, { headers: { Accept: 'application/json' } });
    if (!r.ok) return out;
    const arr = await r.json();
    if (!Array.isArray(arr)) return out;
    for (const q of arr) {
      const sym = String(q?.symbol || '').toUpperCase();
      const chg = Number(q?.changePercentage ?? q?.changesPercentage);
      if (sym) out[sym] = Number.isFinite(chg) ? chg : null;
    }
  } catch { /* se devuelve lo que haya; los huecos se declaran en el informe */ }
  return out;
}

export async function GET(request) {
  const denied = assertCron(request); if (denied) return denied;
  if (!SB || !KEY) return json({ error: 'Supabase not configured' }, 500);
  if (!process.env.FMP_KEY) return json({ error: 'FMP_KEY missing' }, 500);

  // 1 · los dos snapshots macro más recientes (el previo detecta el cambio de régimen)
  const mRes = await fetch(`${SB}/rest/v1/macro_state?select=*&order=snapshot_date.desc&limit=2`, { headers: sbHeaders });
  const mRows = mRes.ok ? await mRes.json().catch(() => []) : [];
  const macro = Array.isArray(mRows) && mRows[0] ? mRows[0] : null;
  const prevMacro = Array.isArray(mRows) && mRows[1] ? mRows[1] : null;

  // 2 · una sola llamada para índice + sectores
  const symbols = ['SPY', ...SECTOR_UNIVERSE.map((s) => s.etf)];
  const quotes = await fetchQuotes(symbols);
  const sectors = SECTOR_UNIVERSE.map((s) => ({ ...s, changePct: quotes[s.etf] ?? null }));
  const spy = quotes.SPY != null ? { changePct: quotes.SPY } : null;

  // 3 · construir. La fecha la marca el snapshot macro si existe; si no, hoy en UTC.
  const date = (macro && macro.snapshot_date ? String(macro.snapshot_date) : new Date().toISOString()).slice(0, 10);
  const report = buildDailyClose({ macro, prevMacro, spy, sectors, date });

  // Un informe sin NADA medido no se publica: sería una página con la marca Scora que no
  // dice nada comprobable. Mejor no escribir fila y que el cron lo reporte.
  if (report.gaps.length >= 3) {
    return json({ ok: false, reason: 'no measurable data', gaps: report.gaps, date }, 503);
  }

  // 4 · upsert idempotente por día — re-ejecutar el cron no duplica ni rompe.
  const up = await fetch(`${SB}/rest/v1/sl_daily_close?on_conflict=close_date`, {
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
