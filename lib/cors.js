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

const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://scora-research.vercel.app',
  'https://ic-suite.vercel.app',
  'https://ic-datalayer-app.vercel.app',
  'https://stock-analyzer.vercel.app',
];

// Vercel preview deploys: <project>-<hash>-<team>.vercel.app
const PREVIEW = /^https:\/\/(scora-research|ic-suite|ic-datalayer-app|stock-analyzer)-[a-z0-9-]+\.vercel\.app$/;

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
  return allowlist().has(origin) || PREVIEW.test(origin) ? origin : null;
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
