// Guard de segmentos de los catch-all (/api/fmp/[...path] y /api/finnhub/[...path]).
//   node scripts/segment.test.mjs
//
// POR QUÉ EXISTE: el allowlist comprobaba el path CRUDO y luego lo metía en new URL(),
// que normaliza los ".." antes de llamar al proveedor. Una barra codificada
// ("quote%2F..%2F..%2Fotro") pasaba el allowlist y salía apuntando a otro endpoint con
// nuestra API key. El guard debe garantizar un invariante: el path que se valida y el
// que se pide son el MISMO string, sin normalización de por medio.
//
// Se prueban los dos supuestos sobre Next (que entregue params.path decodificado o no)
// para que el resultado no dependa de la versión del framework.

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const isDotSegment = (s) => s === '.' || s === '..';
const ALLOWED = new Set(['quote', 'profile', 'income-statement', 'historical-price-eod/full', 'search']);

function guard(segments) {
  if (!segments.every((s) => SAFE_SEGMENT.test(s) && !isDotSegment(s))) return { code: 400 };
  const path = segments.join('/');
  if (![...ALLOWED].some((p) => path === p || path.startsWith(p + '/'))) return { code: 403 };
  return { code: 200, path };
}

const cases = [
  [['quote'],                       200, 'legítimo: quote'],
  [['historical-price-eod', 'full'],200, 'legítimo: sub-ruta permitida'],
  [['income-statement'],            200, 'legítimo: statement'],
  [['quote', 'AAPL'],               200, 'legítimo: prefijo + sufijo'],

  [['quote/../../admin'],           400, 'ataque decodificado (barra en el segmento)'],
  [['quote/..'],                    400, 'ataque decodificado corto'],
  [['quote%2F..%2F..%2Fadmin'],     400, 'ataque sin decodificar (% literal)'],
  [['quote', '..', '..', 'admin'],  400, 'ataque en segmentos separados'],
  [['..', '..', 'etc'],             400, 'traversal puro'],
  [['quote', '%2e%2e', 'admin'],    400, 'punto-punto codificado'],
  [['quote', '.', 'admin'],         400, 'punto simple (lo colapsa new URL)'],
  [['.'],                           400, 'punto solo'],
  [['premium-endpoint'],            403, 'fuera del allowlist'],
  [['quote', 'a b'],                400, 'espacio en el segmento'],
  [['quote', 'a?b'],                400, 'query dentro del segmento'],
];

let bad = 0;
for (const [segs, want, label] of cases) {
  const got = guard(segs).code;
  if (got !== want) { bad++; console.log(`FAIL  ${label}: ${got}, esperado ${want}`); }
}

// El invariante: para todo path aceptado, normalizar no debe cambiarlo.
for (const [segs] of cases) {
  const r = guard(segs);
  if (r.code !== 200) continue;
  const normalizado = new URL(`https://x.invalid/base/${r.path}`).pathname.replace('/base/', '');
  if (normalizado !== r.path) {
    bad++;
    console.log(`FAIL  invariante roto: se validó "${r.path}" pero se pediría "${normalizado}"`);
  }
}

console.log(bad ? `\nsegment: ${bad} fallo(s)` : `\nsegment: ${cases.length} casos + invariante de normalización OK`);
process.exit(bad ? 1 : 0);
