#!/usr/bin/env node
// verify-prod.mjs — Verificación post-despliegue de las mejoras de research.
//
// Comprueba, contra PRODUCCIÓN, que:
//   1) las columnas nuevas existen en macro_state  (las 4 migraciones aplicadas)
//   2) el cron macro-refresh las está escribiendo   (dispara el cron, lee `wrote`)
//   3) macro_state está fresco                       (updated_at reciente)
//   4) ambas apps montan limpias                     (reutiliza el smoke headless)
//
// NO escribe nada destructivo: el cron es un upsert idempotente sobre la fila id=1.
//
// USO:
//   CRON_SECRET=... SUPABASE_SERVICE_KEY=... node scripts/verify-prod.mjs
//   (toma .env.local automáticamente si existe; las env explícitas mandan)
//
// CONFIG (env vars, todas con default salvo los secretos):
//   PROXY_URL            (obligatoria — la URL del servicio desplegado)
//   CRON_SECRET          (necesario para el check del cron)
//   SUPABASE_URL         (necesario para los checks de columnas/frescura)
//   SUPABASE_SERVICE_KEY  ó  SUPABASE_ANON_KEY  (uno de los dos)
//   STOCKLENS_URL        (def. https://stock-lens-app.vercel.app)
//   ICDL_URL             (def. https://ic-datalayer-app.vercel.app)
//   SKIP_SMOKE=1         (omite el paso 4)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Cargar .env.local (sin pisar lo que ya esté en el entorno) ──
(function loadEnvLocal() {
  const p = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const k = m[1];
    let v = m[2].replace(/^["']|["']$/g, '');
    if (process.env[k] == null || process.env[k] === '') process.env[k] = v;
  }
})();

const CFG = {
  PROXY_URL: (process.env.PROXY_URL || '').replace(/\/$/, ''),
  CRON_SECRET: process.env.CRON_SECRET || '',
  SUPABASE_URL: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  SUPABASE_KEY: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '',
  STOCKLENS_URL: process.env.STOCKLENS_URL || 'https://stock-lens-app.vercel.app',
  ICDL_URL: process.env.ICDL_URL || 'https://ic-datalayer-app.vercel.app',
  SKIP_SMOKE: process.env.SKIP_SMOKE === '1',
};

// Columnas nuevas por migración.
const NEW_COLUMNS = {
  'Tier 1 (A1–A4)': ['dgs2', 'dgs10', 'dgs30', 'term_premium_10y', 'curve_steepener', 'net_liquidity_t', 'net_liquidity_dir', 'boj_assets', 'claims_trend', 'profits_trend', 'recession_gate_active', 'credit_private_proxy', 'credit_divergence'],
  'Tier 2 (A5–A7)': ['fed_room', 'core_pce_yoy', 'unrate', 'oil_shock', 'wti_level', 'wti_chg_1m', 'buffett_indicator', 'expected_return_10y'],
  'Tier 3 (liq global)': ['ecb_assets', 'global_liquidity_dir'],
  'A8 (sentiment)': ['put_call_ratio', 'fear_greed', 'fear_greed_rating', 'sentiment_signal'],
};
const ALL_COLS = Object.values(NEW_COLUMNS).flat();
// Campos que pueden venir null legítimamente (dependencias externas) → WARN, no FAIL.
const MAY_BE_NULL = new Set(['credit_private_proxy', 'credit_divergence', 'put_call_ratio', 'fear_greed', 'fear_greed_rating', 'sentiment_signal', 'oil_shock', 'recession_gate_active']);

const C = { reset: '\x1b[0m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', dim: '\x1b[2m', cyan: '\x1b[36m' };
let fails = 0, warns = 0;
const PASS = (m) => console.log(`  ${C.grn}✓${C.reset} ${m}`);
const FAIL = (m) => { fails++; console.log(`  ${C.red}✗ ${m}${C.reset}`); };
const WARN = (m) => { warns++; console.log(`  ${C.yel}⚠ ${m}${C.reset}`); };
const SKIP = (m) => console.log(`  ${C.dim}∅ SKIP — ${m}${C.reset}`);
const H = (m) => console.log(`\n${C.cyan}${m}${C.reset}`);

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  let body = null;
  try { body = await r.json(); } catch { /* may be text */ }
  return { status: r.status, ok: r.ok, body };
}

// ── 1) Columnas existen ──────────────────────────────────────────────────────
async function checkColumns() {
  H('1) Columnas nuevas en macro_state');
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY) {
    SKIP('faltan SUPABASE_URL / SUPABASE_SERVICE_KEY (o ANON). Exporta y reintenta.');
    return null;
  }
  const url = `${CFG.SUPABASE_URL}/rest/v1/macro_state?id=eq.1&select=${ALL_COLS.join(',')}`;
  const { status, ok, body } = await getJSON(url, {
    headers: { apikey: CFG.SUPABASE_KEY, Authorization: `Bearer ${CFG.SUPABASE_KEY}` },
  });
  if (status === 400) {
    const msg = (body && (body.message || body.hint)) || JSON.stringify(body);
    FAIL(`Supabase 400 — probablemente faltan migraciones: ${msg}`);
    return null;
  }
  if (!ok) { FAIL(`Supabase HTTP ${status} ${JSON.stringify(body)}`); return null; }
  PASS(`las ${ALL_COLS.length} columnas nuevas existen (SELECT 200 OK)`);
  const row = Array.isArray(body) ? body[0] : body;
  if (!row) WARN('macro_state no tiene fila id=1 todavía (el cron aún no ha corrido).');
  return row || null;
}

// ── 2) Cron escribe las columnas ─────────────────────────────────────────────
async function checkCron() {
  H('2) El cron macro-refresh escribe las columnas');
  if (!CFG.CRON_SECRET) { SKIP('falta CRON_SECRET. Exporta y reintenta.'); return; }
  const { status, ok, body } = await getJSON(`${CFG.PROXY_URL}/api/cron/macro-refresh`, {
    headers: { Authorization: `Bearer ${CFG.CRON_SECRET}` },
  });
  if (status === 401) { FAIL('cron 401 — CRON_SECRET incorrecto.'); return; }
  if (!ok || !body) { FAIL(`cron HTTP ${status} ${JSON.stringify(body)}`); return; }
  if (body.ok !== true) {
    FAIL(`cron respondió ok=${body.ok} (supabase_status=${body.supabase_status}, error=${body.supabase_error || '—'})`);
    return;
  }
  PASS(`cron ok=true, supabase_status=${body.supabase_status}, seriesFetched=${body.seriesFetched}`);
  const wrote = body.wrote || {};
  for (const [group, cols] of Object.entries(NEW_COLUMNS)) {
    const present = cols.filter((c) => c in wrote);
    const missing = cols.filter((c) => !(c in wrote));
    const nullish = present.filter((c) => wrote[c] == null && !MAY_BE_NULL.has(c));
    const extNull = present.filter((c) => wrote[c] == null && MAY_BE_NULL.has(c));
    if (missing.length) FAIL(`${group}: el cron NO escribe ${missing.join(', ')}`);
    else PASS(`${group}: las ${cols.length} columnas presentes en el upsert`);
    if (nullish.length) FAIL(`${group}: null inesperado (FRED debería traer dato) → ${nullish.join(', ')}`);
    if (extNull.length) WARN(`${group}: null en dependencias externas (FMP/CNN) → ${extNull.join(', ')}`);
  }
  if (body.fred_errors) WARN(`fred_errors: ${JSON.stringify(body.fred_errors)}`);
}

// ── 3) Frescura de macro_state ───────────────────────────────────────────────
async function checkFreshness() {
  H('3) Frescura de macro_state');
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY) { SKIP('faltan credenciales Supabase.'); return; }
  const url = `${CFG.SUPABASE_URL}/rest/v1/macro_state?id=eq.1&select=updated_at,regime_id,dgs30,net_liquidity_dir,buffett_indicator,put_call_ratio`;
  const { ok, status, body } = await getJSON(url, {
    headers: { apikey: CFG.SUPABASE_KEY, Authorization: `Bearer ${CFG.SUPABASE_KEY}` },
  });
  if (!ok) { FAIL(`Supabase HTTP ${status}`); return; }
  const row = Array.isArray(body) ? body[0] : body;
  if (!row) { FAIL('sin fila id=1.'); return; }
  const ageH = (Date.now() - new Date(row.updated_at).getTime()) / 3.6e6;
  const ageStr = ageH < 1 ? '<1h' : ageH < 48 ? `${Math.round(ageH)}h` : `${Math.round(ageH / 24)}d`;
  if (ageH <= 48) PASS(`updated_at hace ${ageStr} · régimen=${row.regime_id} · dgs30=${row.dgs30} · liq=${row.net_liquidity_dir} · buffett=${row.buffett_indicator} · p/c=${row.put_call_ratio}`);
  else WARN(`macro_state rancio (hace ${ageStr}) — ¿el cron diario está activo en Vercel?`);
}

// ── 4) Ambas apps montan ─────────────────────────────────────────────────────
function checkSmoke() {
  return new Promise((resolve) => {
    H('4) Ambas apps montan (smoke headless)');
    if (CFG.SKIP_SMOKE) { SKIP('SKIP_SMOKE=1'); return resolve(); }
    const smoke = path.resolve(__dirname, '..', '..', 'StockAnalyzer', 'scripts', 'smoke.js');
    if (!fs.existsSync(smoke)) {
      WARN(`no encuentro ${smoke}. Corre el smoke a mano: node StockAnalyzer/scripts/smoke.js`);
      return resolve();
    }
    const p = spawn(process.execPath, [smoke, CFG.STOCKLENS_URL, CFG.ICDL_URL], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => {
      if (code === 0) PASS('smoke OK — ambas apps montaron limpias');
      else { FAIL(`smoke salió con código ${code}`); console.log(C.dim + out.split('\n').slice(-12).join('\n') + C.reset); }
      resolve();
    });
  });
}

(async () => {
  console.log(`${C.cyan}── Verificación de prod — mejoras de research ──${C.reset}`);
  console.log(`${C.dim}proxy=${CFG.PROXY_URL} · supabase=${CFG.SUPABASE_URL ? 'set' : 'MISSING'} · cron_secret=${CFG.CRON_SECRET ? 'set' : 'MISSING'}${C.reset}`);
  await checkColumns();
  await checkCron();
  await checkFreshness();
  await checkSmoke();
  console.log(`\n${C.cyan}── Resumen ──${C.reset}`);
  if (fails) console.log(`  ${C.red}${fails} FAIL${C.reset}, ${warns} warn — revisa arriba.`);
  else if (warns) console.log(`  ${C.grn}0 FAIL${C.reset}, ${C.yel}${warns} warn${C.reset} (dependencias externas/rancio — revisa si aplica).`);
  else console.log(`  ${C.grn}Todo verde.${C.reset}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('verify-prod error:', e); process.exit(2); });
