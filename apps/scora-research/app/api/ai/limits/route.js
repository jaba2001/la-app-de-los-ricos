// Los límites diarios de IA de cada plan, para que /pricing los anuncie bien.
//
// POR QUÉ NO SE ESCRIBEN EN EL FRONT:
// los límites viven en variables de entorno del proxy (AI_DAILY_FREE / AI_DAILY_PRO) para
// poder ajustarlos sin desplegar. Copiarlos en la página de precios reintroduce justo el
// problema que esas variables evitan: se sube el límite, se olvida la copia, y la página
// anuncia una cifra distinta de la que se aplica. Anunciar una cosa y entregar otra es un
// problema de confianza, no de maquetación.
//
// Público y sin autenticar a propósito: son datos de producto, los mismos que aparecen en
// la página de precios. No revelan nada del uso de nadie.
import { corsHeaders, preflight } from '../../../../lib/server/cors.js';
import { dailyLimit } from '../../../../lib/server/quota.js';

export const runtime = 'edge';

export async function GET(request) {
  return new Response(
    JSON.stringify({ free: dailyLimit(false), pro: dailyLimit(true) }),
    {
      status: 200,
      headers: corsHeaders(request, {
        'Content-Type': 'application/json',
        // Cinco minutos: cambiar un límite no debería tardar una hora en verse, y tampoco
        // hace falta preguntarlo en cada carga.
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      }),
    }
  );
}

export async function OPTIONS(request) {
  return preflight(request, 'GET, OPTIONS');
}
