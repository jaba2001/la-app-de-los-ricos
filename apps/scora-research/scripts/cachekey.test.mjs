// Claves de caché (lib/server/cache.js).
//   node scripts/cachekey.test.mjs
//
// POR QUÉ EXISTE: la clave incluía cualquier parámetro de la query, así que un usuario
// autenticado podía sembrar entradas ilimitadas añadiendo basura. La instancia de Upstash
// está en `noeviction`: llena no descarta lo viejo, RECHAZA escrituras — y el rate limiter
// escribe en esa misma instancia, así que inundar la caché se lleva por delante el control
// de coste. Ahora un parámetro desconocido devuelve null = "sirve, pero no caches".
//
// Los parámetros conocidos salen de lo que la app manda de verdad:
//   grep -rhoE "api/(fmp|finnhub)/[^`\"']*" scora-research/{lib,components,app}
// Si se añade uno nuevo en el cliente, hay que añadirlo también en KNOWN_PARAMS o esas
// llamadas dejarán de cachearse (más lentas, nunca rotas).
import { cacheKey } from '../lib/server/cache.js';

const sp = (q) => new URLSearchParams(q);
let bad = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) { bad++; console.log(`FAIL  ${label}\n      got:  ${got}\n      want: ${want}`); }
};

// Los parámetros que la app usa de verdad SÍ se cachean.
check('symbol', cacheKey('fmp', 'quote', sp('symbol=AAPL')), 'fmp:quote?symbol=AAPL');
check('symbol+period+limit',
  cacheKey('fmp', 'balance-sheet-statement', sp('symbol=AAPL&period=quarter&limit=12')),
  'fmp:balance-sheet-statement?limit=12&period=quarter&symbol=AAPL');
check('from/to', cacheKey('finnhub', 'company-news', sp('symbol=AAPL&from=2026-01-01&to=2026-02-01')),
  'finnhub:company-news?from=2026-01-01&symbol=AAPL&to=2026-02-01');
check('metric', cacheKey('finnhub', 'stock/metric', sp('symbol=AAPL&metric=all')),
  'finnhub:stock/metric?metric=all&symbol=AAPL');
check('id', cacheKey('finnhub', 'stock/transcripts', sp('id=abc123')), 'finnhub:stock/transcripts?id=abc123');
check('sin params', cacheKey('fmp', 'search', sp('')), 'fmp:search');

// El orden no debe crear dos entradas para la misma petición.
check('orden estable',
  cacheKey('fmp', 'quote', sp('limit=1&symbol=A')),
  cacheKey('fmp', 'quote', sp('symbol=A&limit=1')));

// Las credenciales nunca entran en la clave (y no cuentan como desconocidas).
check('apikey se descarta', cacheKey('fmp', 'quote', sp('symbol=A&apikey=secreto')), 'fmp:quote?symbol=A');
check('token se descarta', cacheKey('finnhub', 'quote', sp('symbol=A&token=secreto')), 'finnhub:quote?symbol=A');

// Lo nuevo: basura => null => no se cachea.
check('param desconocido', cacheKey('fmp', 'quote', sp('symbol=AAPL&junk=1')), null);
check('inundacion numerada', cacheKey('fmp', 'quote', sp('symbol=AAPL&x=99999')), null);
check('solo basura', cacheKey('fmp', 'quote', sp('nope=1')), null);
check('mayusculas tambien', cacheKey('fmp', 'quote', sp('symbol=A&JUNK=1')), null);

// Namespaces distintos no colisionan.
check('namespace separa',
  cacheKey('fmp', 'quote', sp('symbol=A')) === cacheKey('finnhub', 'quote', sp('symbol=A')) ? 'colision' : 'ok',
  'ok');

console.log(bad ? `\ncachekey: ${bad} fallo(s)` : '\ncachekey: 14 comprobaciones OK');
process.exit(bad ? 1 : 0);
