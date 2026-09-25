// AISLAMIENTO, de extremo a extremo contra un Postgres REAL con el esquema migrado.
//   PGHOST=/tmp/scpg PGPORT=5544 node --experimental-strip-types --no-warnings scripts/aislamiento-e2e.test.mjs
//
// scripts/aislamiento.test.mjs prueba que el SQL SE CONSTRUYE bien. Esto prueba que, una vez
// ejecutado contra Postgres, Ana no recibe ni una fila de Beni. Son cosas distintas: un
// generador correcto con un esquema inesperado (una columna que se llama distinto, un
// indice que falta) puede acabar devolviendo de mas.
//
// Se SALTA si no hay base de datos, para no romper el CI. En local se levanta una desechable:
//   initdb -D /tmp/pgdata -U postgres --no-locale
//   LC_ALL=C pg_ctl -D /tmp/pgdata -o "-p 5544 -h '' -k /tmp/scpg" start
//   psql -h /tmp/scpg -p 5544 -U postgres -c 'create database scora'
//   psql -h /tmp/scpg -p 5544 -U postgres -d scora -f sql/gcp/001_schema.sql
import pg from 'pg';
import { construir } from '../lib/server/data/query.ts';

const ANA  = "11111111-1111-1111-1111-111111111111";
const BENI = "22222222-2222-2222-2222-222222222222";
const c = new pg.Client({
  host: process.env.PGHOST || '/tmp/scpg',
  port: Number(process.env.PGPORT || 5544),
  user: process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'scora',
});
try {
  await c.connect();
} catch {
  console.log('\n○ aislamiento e2e: SALTADO — no hay Postgres en ' + (process.env.PGHOST || '/tmp/scpg'));
  console.log('  (la prueba de construccion, scripts/aislamiento.test.mjs, si corre siempre)');
  process.exit(0);
}

// Esquema real, leido de la base
// El ::text no es decorativo: column_name es de tipo information_schema.sql_identifier y
// el driver no sabe convertir un array de ese tipo, asi que devolvia la cadena cruda
// "{id,user_id,...}" y el Set acababa lleno de LETRAS. Toda columna daba "no permitida".
const { rows } = await c.query(`select table_name::text, array_agg(column_name::text) cols
  from information_schema.columns where table_schema='public' group by 1`);
const ESQ = Object.fromEntries(rows.map(r => [r.table_name, new Set(r.cols)]));

const corre = async (pet, uid) => { const s = construir(pet, uid, ESQ); return (await c.query(s.text, s.values)).rows; };

let bad = 0;
const check = (l, got, want) => { if (!Object.is(got, want)) { bad++; console.log(`FAIL ${l}: ${got} != ${want}`); } };

await c.query('truncate sl_watchlist, sl_journal cascade');

// Ana y Beni escriben, cada uno a traves de la capa
await corre({ table: 'sl_watchlist', op: 'insert', rows: [{ ticker: 'AAPL' }, { ticker: 'MSFT' }] }, ANA);
await corre({ table: 'sl_watchlist', op: 'insert', rows: [{ ticker: 'TSLA' }] }, BENI);
// Beni intenta escribir a nombre de Ana
await corre({ table: 'sl_watchlist', op: 'insert', rows: [{ ticker: 'NVDA', user_id: ANA }] }, BENI);

const deAna  = await corre({ table: 'sl_watchlist', op: 'select' }, ANA);
const deBeni = await corre({ table: 'sl_watchlist', op: 'select' }, BENI);
const total  = (await c.query('select count(*)::int n from sl_watchlist')).rows[0].n;

console.log('filas totales en la tabla :', total);
console.log('Ana ve  :', deAna.map(r => r.ticker).sort().join(', '));
console.log('Beni ve :', deBeni.map(r => r.ticker).sort().join(', '));

check('hay 4 filas en total', total, 4);
check('Ana ve solo 2', deAna.length, 2);
check('Beni ve 2 (las suyas, incluida la que intento colar)', deBeni.length, 2);
check('Ana NO ve TSLA', deAna.some(r => r.ticker === 'TSLA'), false);
check('Ana NO ve NVDA (Beni no pudo ponerla a su nombre)', deAna.some(r => r.ticker === 'NVDA'), false);
check('todas las de Ana son suyas', deAna.every(r => r.user_id === ANA), true);
check('todas las de Beni son suyas', deBeni.every(r => r.user_id === BENI), true);

// Ana intenta borrar lo de Beni
await corre({ table: 'sl_watchlist', op: 'delete', filters: [{ col: 'ticker', op: 'eq', val: 'TSLA' }] }, ANA);
check('TSLA de Beni sigue ahi tras el intento de Ana', (await corre({ table: 'sl_watchlist', op: 'select' }, BENI)).some(r => r.ticker === 'TSLA'), true);

// Compartida: los dos ven lo mismo
await c.query("insert into macro_state (id) values (1) on conflict (id) do nothing");
check('macro_state la ven ambos', (await corre({ table: 'macro_state', op: 'select' }, ANA)).length, (await corre({ table: 'macro_state', op: 'select' }, BENI)).length);

await c.end();
console.log(bad ? `\nE2E: ${bad} FALLO(S)` : '\nE2E: 9 comprobaciones OK contra Postgres real');
process.exit(bad ? 1 : 0);
