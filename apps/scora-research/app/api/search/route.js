// Buscador de valores de la barra y de /stock (components/TickerSearch).
//   GET /api/search?q=<ticker o nombre>&limit=8 → { query, results: [{ symbol, name, exchange, type }] }
// La búsqueda está en lib/server/busqueda.js; aquí solo la sesión, el límite y la respuesta.
import { requireUser } from '../../../lib/server/auth.js';
import { checkRateLimit } from '../../../lib/server/ratelimit.js';
import { corsHeaders, preflight } from '../../../lib/server/cors.js';
import { buscar, buscarEnYahoo, indiceSEC, prepararConsulta } from '../../../lib/server/busqueda.js';

// Node, no edge: el índice de la SEC (~10.000 valores) vive en la memoria del proceso y se
// reutiliza entre peticiones; descargarlo en cada una sería medio megabyte por tecla.
export const runtime = 'nodejs';

// Con la espera de 180 ms del cliente, escribir sin parar son ~5 por segundo. 120 por minuto
// da para teclear con soltura y corta un bucle o un abuso. No cuesta cuota de nadie: la SEC y
// Yahoo son gratis, y lo repetido sale de la caché en memoria.
const LIMITE = { max: 120, window: 60 };

export async function GET(request) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const rl = await checkRateLimit('search', user.id, LIMITE.max, LIMITE.window, request); if (rl) return rl;

  const url = new URL(request.url);
  const c = prepararConsulta(url.searchParams.get('q'));
  const limite = Math.min(15, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '', 10) || 8));

  let results = [];
  if (c.nn || c.ticker) {
    // En paralelo: Yahoo no espera a la SEC. Ninguna de las dos falla (devuelven null o []).
    const [sec, yahoo] = await Promise.all([indiceSEC(), c.raw.length >= 2 ? buscarEnYahoo(c.raw) : []]);
    results = buscar(c, { sec: sec ?? [], yahoo, limite });
  }

  return new Response(JSON.stringify({ query: c.raw, results }), {
    status: 200,
    headers: corsHeaders(request, {
      'Content-Type': 'application/json',
      // Privada: va con la sesión del usuario. Cinco minutos bastan para que borrar y volver a
      // escribir lo mismo no salga a la red.
      'Cache-Control': 'private, max-age=300',
    }),
  });
}

export async function OPTIONS(request) {
  return preflight(request);
}
