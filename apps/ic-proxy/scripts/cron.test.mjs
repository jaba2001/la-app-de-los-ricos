// Guard de los crons (lib/cron.js). Sin dependencias:
//   node scripts/cron.test.mjs
//
// POR QUÉ EXISTE: contra producción solo se puede probar la rama NEGATIVA — mandar un
// secreto incorrecto y ver el 401. La rama POSITIVA (secreto correcto => ejecuta) no se
// puede probar desde fuera sin conocer CRON_SECRET, y esas rutas corren con
// SUPABASE_SERVICE_KEY (saltan RLS) y mandan push a todos los usuarios: si el guard
// rechazara la llamada legítima, los 7 crons se quedarían en 401 en silencio y el dato
// se congelaría hasta que alguien mirara macro_state.updated_at.
//
// Aquí se prueba con un CRON_SECRET propio, así que la rama positiva SÍ es observable.
// Lo que este test NO cubre: que Vercel adjunte de verdad la cabecera con el valor de la
// env var. Eso es contrato de la plataforma y se comprueba en producción viendo que
// macro_state.updated_at avanza tras las 11:00 UTC (o con `vercel crons run`).
import { assertCron, pgv } from '../lib/cron.js';

// Request real de undici: cabeceras case-insensitive como en el runtime, no un mock.
const req = (headers) => new Request('https://ic-proxy.vercel.app/api/cron/macro-refresh', { headers });

let bad = 0;
let n = 0;
function check(label, got, want) {
  n++;
  if (got !== want) { bad++; console.log(`FAIL  ${label}\n      got:  ${got}\n      want: ${want}`); }
}
// null = pasa el guard; si no, el código de estado del rechazo.
const status = (r) => (r === null ? 'PASA' : r.status);

// ── Rama POSITIVA: la que no se puede medir contra producción ──────────────────
const SECRET = 'aB3$k9-Zq_1PLmN0/xY+7=';   // con los caracteres feos de un secreto real
process.env.CRON_SECRET = SECRET;

check('secreto correcto', status(assertCron(req({ Authorization: `Bearer ${SECRET}` }))), 'PASA');
// Vercel manda las cabeceras en minúsculas por HTTP/2; Headers normaliza, pero se fija.
check('cabecera en minusculas', status(assertCron(req({ authorization: `Bearer ${SECRET}` }))), 'PASA');
check('cabecera capitalizada raro', status(assertCron(req({ AuThOrIzAtIoN: `Bearer ${SECRET}` }))), 'PASA');

// ── Rama NEGATIVA ──────────────────────────────────────────────────────────────
check('sin cabecera',            status(assertCron(req({}))), 401);
check('cabecera vacia',          status(assertCron(req({ Authorization: '' }))), 401);
check('otro secreto, igual long', status(assertCron(req({ Authorization: `Bearer ${'x'.repeat(SECRET.length)}` }))), 401);
check('otro secreto, otra long',  status(assertCron(req({ Authorization: 'Bearer nope' }))), 401);
check('secreto sin el prefijo',   status(assertCron(req({ Authorization: SECRET }))), 401);
check('prefijo mal escrito',      status(assertCron(req({ Authorization: `bearer ${SECRET}` }))), 401);
check('espacio de mas',           status(assertCron(req({ Authorization: `Bearer  ${SECRET}` }))), 401);
check('secreto truncado',         status(assertCron(req({ Authorization: `Bearer ${SECRET.slice(0, -1)}` }))), 401);
check('secreto con sufijo',       status(assertCron(req({ Authorization: `Bearer ${SECRET}x` }))), 401);
check('solo el prefijo',          status(assertCron(req({ Authorization: 'Bearer ' }))), 401);

// ── FAIL-CLOSED: el bug que motivó este fichero ────────────────────────────────
// Antes se comparaba contra `Bearer ${process.env.CRON_SECRET}`: sin la env var, la
// cadena literal "Bearer undefined" AUTENTICABA. Ahora falta env => 503, nunca PASA.
delete process.env.CRON_SECRET;
check('sin env: "Bearer undefined"', status(assertCron(req({ Authorization: 'Bearer undefined' }))), 503);
check('sin env: secreto de ayer',    status(assertCron(req({ Authorization: `Bearer ${SECRET}` }))), 503);
check('sin env: sin cabecera',       status(assertCron(req({}))), 503);
process.env.CRON_SECRET = '';
check('env vacia',                   status(assertCron(req({ Authorization: 'Bearer ' }))), 503);

// ── pgv: los valores nunca se interpolan crudos en el query string de PostgREST ─
// Todos los usos son filtros `eq.`/`gte.`, donde lo peligroso es cerrar el valor y
// añadir otro filtro: `&` (otro parámetro) o `,` (otra condición dentro de or=()).
check('valor normal',        pgv('AAPL'), 'AAPL');
check('& se escapa',         pgv('1&select=*'), '1%26select%3D*');
check('coma se escapa',      pgv('a,b'), 'a%2Cb');
check('parentesis y espacio', pgv('1) or true--'), '1)%20or%20true--');
check('interrogacion',       pgv('a?b=c'), 'a%3Fb%3Dc');
check('no-string',           pgv(42), '42');
check('null',                pgv(null), 'null');

console.log(bad ? `\ncron: ${bad} fallo(s) de ${n}` : `\ncron: ${n} comprobaciones OK`);
process.exit(bad ? 1 : 0);
