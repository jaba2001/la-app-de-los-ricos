// Test del allowlist de orígenes (lib/server/cors.js). Sin dependencias:
//   node scripts/cors.test.mjs
//
// POR QUÉ EXISTE: la primera versión de este allowlist se escribió DEDUCIENDO los
// dominios a partir de los nombres de proyecto en Vercel. Dos errores salieron de ahí:
//   · El proyecto "stock-analyzer" no sirve en stock-analyzer.vercel.app sino en
//     stock-lens-app.vercel.app. La app real quedaba BLOQUEADA.
//   · stock-analyzer.vercel.app existe, pero es de otra cuenta de Vercel. Un dominio
//     ajeno quedaba AUTORIZADO.
// Los dominios de abajo están leídos de la API de Vercel. Si añades uno, compruébalo
// de verdad (`vercel project ls` o el dashboard) antes de tocar la lista.
import { allowOrigin, preflight } from '../lib/server/cors.js';

const req = (o) => ({ headers: { get: (k) => (k.toLowerCase() === 'origin' ? o : null) } });

const cases = [
  // Producción: los dominios que sirven las apps de verdad.
  ['https://scora-research.vercel.app',           true,  'Scora (prod)'],
  ['https://ic-suite.vercel.app',                 true,  'ic-suite (prod)'],
  ['https://ic-datalayer-app.vercel.app',         true,  'IC-DataLayer (prod)'],
  ['https://stock-lens-app.vercel.app',           true,  'StockLens (prod real)'],
  ['https://stock-analyzer-blue-beta.vercel.app', true,  'StockLens (alias)'],

  // Previews, tal y como Vercel los nombra (ojo: trunca el nombre del proyecto).
  ['https://scora-research-benjpqqbj-alealvarado804-6375s-projects.vercel.app', true, 'preview Scora'],
  ['https://ic-datalayer-qdu9m0be6-alealvarado804-6375s-projects.vercel.app',   true, 'preview IC-DL (truncado)'],
  ['https://stock-analyzer-c5m3qj4kg-alealvarado804-6375s-projects.vercel.app', true, 'preview StockLens'],
  ['https://ic-suite-f9fvftrhg-alealvarado804-6375s-projects.vercel.app',       true, 'preview ic-suite'],
  ['https://scora-research-git-main-alealvarado804-6375s-projects.vercel.app',  true, 'alias de rama'],

  ['http://localhost:3000', true,  'dev local'],
  ['http://127.0.0.1:3000', true,  'dev local (IP)'],
  [null,                    false, 'sin Origin (cron/curl)'],

  // Lo que NO debe entrar.
  ['https://stock-analyzer.vercel.app',          false, 'dominio de un tercero'],
  ['https://scora-research-evil.vercel.app',     false, 'prefijo secuestrable'],
  ['https://ic-suite-attacker.vercel.app',       false, 'prefijo secuestrable (2)'],
  ['https://evil.com',                           false, 'origen ajeno'],
  ['https://scora-research.vercel.app.evil.com', false, 'sufijo falsificado'],
  ['http://scora-research.vercel.app',           false, 'mismo host por HTTP'],
  ['https://otro-proyecto.vercel.app',           false, 'otro proyecto de vercel'],
  ['null',                                       false, 'Origin literal "null"'],
];

let bad = 0;
for (const [origin, want, label] of cases) {
  const got = allowOrigin(req(origin)) !== null;
  if (got !== want) { bad++; console.log(`FAIL  ${label}: permitido=${got}, esperado=${want}`); }
}

const p403 = preflight(req('https://evil.com')).status;
const p204 = preflight(req('https://stock-lens-app.vercel.app')).status;
if (p403 !== 403) { bad++; console.log(`FAIL  preflight ajeno: ${p403}, esperado 403`); }
if (p204 !== 204) { bad++; console.log(`FAIL  preflight propio: ${p204}, esperado 204`); }

console.log(bad ? `\ncors: ${bad} fallo(s) de ${cases.length + 2}` : `\ncors: ${cases.length + 2} comprobaciones OK`);
process.exit(bad ? 1 : 0);
