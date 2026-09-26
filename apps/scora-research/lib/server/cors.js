// Origin allowlist for every browser-facing route.
//
// Replaces the previous blanket `Access-Control-Allow-Origin: *`. Four browser clients
// share this proxy (scora-research, ic-suite, ic-datalayer-app, stock-analyzer), all on
// the same Vercel team, so the default list covers their production domains plus their
// preview deploys plus localhost for dev.
//
// CORS is enforced by the browser only: server-to-server callers (Vercel crons, the
// GitHub Actions research jobs, curl) send no Origin header and are unaffected by any of
// this. Auth is still the security boundary — this just stops arbitrary websites from
// driving the paid API surface from a victim's browser.
//
// To add an origin without a code change, set ALLOWED_ORIGINS to a comma-separated list.

// Dominios de producción, LEÍDOS de la API de Vercel, no deducidos del nombre del
// proyecto. Esa diferencia importa: el proyecto "stock-analyzer" NO sirve en
// stock-analyzer.vercel.app sino en stock-lens-app.vercel.app, y el dominio que parecía
// el obvio resultó pertenecer a otro usuario de Vercel (contenido distinto, sin relación
// con este proxy). Deducirlo habría dejado a un tercero dentro del allowlist y a la app
// real fuera. Antes de tocar esta lista, comprueba los dominios de verdad.
const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  // Cloud Run — donde vive Scora desde la migracion. La propia app NO lo necesita (desde
  // que front y back son la misma, el navegador llama al mismo origen y no hay CORS), pero
  // si lo necesitan las otras apps del ecosistema cuando apunten aqui.
  'https://scora-628763661566.europe-west1.run.app',
  // Vercel — el despliegue anterior. Se conserva mientras siga vivo; al apagarlo, fuera.
  'https://scora-research.vercel.app',
  'https://ic-suite.vercel.app',
  'https://ic-datalayer-app.vercel.app',
  'https://stock-lens-app.vercel.app',            // StockLens (proyecto "stock-analyzer")
  'https://stock-analyzer-blue-beta.vercel.app',  // alias del mismo proyecto
];

// Previews y alias de cuenta. Se ancla al slug del equipo en lugar de al nombre del
// proyecto por dos razones:
//   · Cobertura: las URLs de deploy truncan el nombre ("ic-datalayer-<hash>-…", no
//     "ic-datalayer-app-<hash>-…"), así que un patrón por proyecto se dejaba previews.
//   · Precisión: cualquiera puede crear un proyecto llamado "scora-research-loquesea" y
//     quedarse con ese subdominio de vercel.app. El sufijo del equipo no: lo asigna
//     Vercel y solo lo llevan los despliegues de esta cuenta.
const TEAM_PREVIEW = /^https:\/\/[a-z0-9-]+-alealvarado804-6375s-projects\.vercel\.app$/;

let _allowed = null;
function allowlist() {
  if (_allowed) return _allowed;
  const extra = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  _allowed = new Set([...DEFAULT_ORIGINS, ...extra]);
  return _allowed;
}

/** The echo-back origin for this request, or null if it isn't an allowed browser origin. */
export function allowOrigin(request) {
  const origin = request?.headers?.get?.('origin');
  if (!origin) return null; // non-browser caller — no CORS headers needed
  return allowlist().has(origin) || TEAM_PREVIEW.test(origin) ? origin : null;
}

/** Response headers with CORS applied when the origin is allowed. */
export function corsHeaders(request, extra = {}) {
  const origin = allowOrigin(request);
  return origin
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', ...extra }
    : { ...extra };
}

/** Standard preflight reply. Disallowed origins get a bare 403 with no CORS headers. */
export function preflight(request, methods = 'GET, OPTIONS') {
  const origin = allowOrigin(request);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
