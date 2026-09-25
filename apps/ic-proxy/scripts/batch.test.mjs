// Enrutado del lote (app/api/batch/route.js).
//   node scripts/batch.test.mjs
//
// POR QUÉ EXISTE: /api/batch recibe rutas como TEXTO desde el cliente y las convierte en
// llamadas del servidor. Ese es exactamente el sitio donde un `path` mal parseado se
// convierte en una petición a un tercero firmada con nuestras claves, así que lo que se
// prueba aquí no es que las rutas buenas funcionen, sino que las malas NO.
//
// La segunda mitad comprueba que los cubos de rate-limit del lote no se hayan separado de
// los de las rutas individuales. Si se separan, agrupar peticiones deja de costar lo mismo
// que hacerlas sueltas — que es la propiedad que hace honesto a este endpoint.
import { readFileSync } from 'fs';
import { route } from '../app/api/batch/route.js';

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`FAIL  ${label}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

// ── Rutas legítimas ─────────────────────────────────────────────────────────────────
check('fmp simple', route('/api/fmp/quote?symbol=AAPL'),
  { provider: 'fmp', ctx: { params: { path: ['quote'] } }, search: '?symbol=AAPL' });
check('fmp anidada', route('/api/fmp/historical-price-eod/full?symbol=AAPL'),
  { provider: 'fmp', ctx: { params: { path: ['historical-price-eod', 'full'] } }, search: '?symbol=AAPL' });
check('finnhub', route('/api/finnhub/stock/metric?symbol=AAPL&metric=all'),
  { provider: 'finnhub', ctx: { params: { path: ['stock', 'metric'] } }, search: '?symbol=AAPL&metric=all' });
check('congress', route('/api/congress/AAPL'),
  { provider: 'congress', ctx: { params: { ticker: 'AAPL' } }, search: '' });
check('short-interest', route('/api/short-interest?symbol=AAPL'),
  { provider: 'short-interest', ctx: {}, search: '?symbol=AAPL' });
check('edgar', route('/api/edgar?symbol=AAPL'), { provider: 'edgar', ctx: {}, search: '?symbol=AAPL' });
check('simfin', route('/api/simfin?symbol=AAPL'), { provider: 'simfin', ctx: {}, search: '?symbol=AAPL' });
check('edgar con sobras', route('/api/edgar/x'), null);
check('finviz', route('/api/finviz/quote?symbol=AAPL'),
  { provider: 'finviz', ctx: {}, search: '?symbol=AAPL' });

// ── Lo que NO debe pasar ────────────────────────────────────────────────────────────
check('host absoluto', route('https://evil.example/api/fmp/quote'), null);
check('protocol-relative', route('//evil.example/api/fmp/quote'), null);
check('barra doble interna', route('/api/fmp//quote'), null);
check('traversal', route('/api/fmp/../anthropic/messages'), null);
check('traversal codificado en segmento', route('/api/fmp/..%2Fanthropic'), null); // pasa el parser; lo para SAFE_SEGMENT en serve()
check('backslash', route('/api/fmp\\quote'), null);
check('ruta que gasta dinero', route('/api/anthropic/messages'), null);
check('llm tampoco', route('/api/llm'), null);
check('cron jamas', route('/api/cron/macro-refresh'), null);
check('stripe tampoco', route('/api/stripe/checkout'), null);
check('waitlist tampoco', route('/api/waitlist'), null);
check('fred no esta en el lote', route('/api/fred/series?series_id=DGS10'), null);
check('fuera de /api', route('/etc/passwd'), null);
check('vacio', route(''), null);
check('no string', route(null), null);
check('solo /api/', route('/api/'), null);
check('congress sin ticker', route('/api/congress'), null);
check('congress con sobras', route('/api/congress/AAPL/extra'), null);
check('finviz otra cosa', route('/api/finviz/screener?x=1'), null);
check('fmp sin endpoint', route('/api/fmp'), null);

// ── Los cubos del lote == los de las rutas sueltas ──────────────────────────────────
const batchSrc = readFileSync(new URL('../app/api/batch/route.js', import.meta.url), 'utf8');
const declared = {};
for (const m of batchSrc.matchAll(/limiter: '([a-z-]+)',\s*max: (\d+),\s*window: (\d+)/g)) {
  declared[m[1]] = { max: +m[2], window: +m[3] };
}
const ROUTES = {
  fmp:      'app/api/fmp/[...path]/route.js',
  finnhub:  'app/api/finnhub/[...path]/route.js',
  shortint: 'app/api/short-interest/route.js',
  finviz:   'app/api/finviz/quote/route.js',
  edgar:    'app/api/edgar/route.js',
  simfin:   'app/api/simfin/route.js',
  congress: 'app/api/congress/[ticker]/route.js',
};
for (const [name, file] of Object.entries(ROUTES)) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const m = src.match(new RegExp(`checkRateLimit\\('${name}', user\\.id, (\\d+), (\\d+)`));
  check(`cubo ${name} declarado`, Boolean(m && declared[name]), true);
  if (m && declared[name]) {
    check(`cubo ${name} max`, declared[name].max, +m[1]);
    check(`cubo ${name} window`, declared[name].window, +m[2]);
  }
}

console.log(bad ? `\nbatch: ${bad} fallo(s)` : '\nbatch: 49 comprobaciones OK');
process.exit(bad ? 1 : 0);
