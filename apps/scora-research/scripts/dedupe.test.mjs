// Single-flight de la caché (lib/server/cache.js → dedupe).
//   node scripts/dedupe.test.mjs
//
// POR QUÉ EXISTE: la caché evita el SEGUNDO viaje al proveedor, no el primero hecho N veces
// a la vez. Con la entrada fría, veinte peticiones simultáneas del mismo ticker salían las
// veinte a FMP. Lo que se comprueba aquí es que solo trabaja una y que las demás reciben su
// resultado — y, sobre todo, que un fallo NO se comparte más allá de las que ya esperaban:
// cachear un error de red sería convertir un parpadeo del proveedor en una avería nuestra.
import { dedupe, _inflightSize } from '../lib/server/cache.js';

let bad = 0;
const check = (label, got, want) => {
  if (!Object.is(got, want)) { bad++; console.log(`FAIL  ${label}\n      got:  ${got}\n      want: ${want}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Concurrentes con la misma clave → una sola producción ───────────────────────────
{
  let n = 0;
  const prod = async () => { n++; await sleep(20); return 'v'; };
  const rs = await Promise.all([dedupe('a', prod), dedupe('a', prod), dedupe('a', prod)]);
  check('una sola produccion', n, 1);
  check('todas reciben el valor', rs.every((r) => r === 'v'), true);
  check('mapa limpio', _inflightSize(), 0);
}

// ── Claves distintas no se mezclan ──────────────────────────────────────────────────
{
  let n = 0;
  const prod = (v) => async () => { n++; await sleep(10); return v; };
  const [x, y] = await Promise.all([dedupe('k1', prod('uno')), dedupe('k2', prod('dos'))]);
  check('dos claves, dos producciones', n, 2);
  check('valor de k1', x, 'uno');
  check('valor de k2', y, 'dos');
}

// ── Secuenciales: la segunda vuelve a producir (no es una caché) ────────────────────
{
  let n = 0;
  const prod = async () => { n++; return 'v'; };
  await dedupe('s', prod);
  await dedupe('s', prod);
  check('secuenciales producen dos veces', n, 2);
}

// ── Un fallo se propaga a las que esperaban, y NO se queda pegado ───────────────────
{
  let n = 0;
  const falla = async () => { n++; await sleep(10); throw new Error('proveedor caido'); };
  const rs = await Promise.allSettled([dedupe('f', falla), dedupe('f', falla)]);
  check('una sola llamada al proveedor', n, 1);
  check('ambas rechazan', rs.every((r) => r.status === 'rejected'), true);
  check('mapa limpio tras el fallo', _inflightSize(), 0);
  // La siguiente vuelve a intentarlo: el error no se ha cacheado.
  const ok = await dedupe('f', async () => { n++; return 'recuperado'; });
  check('reintenta despues del fallo', ok, 'recuperado');
  check('y produjo de nuevo', n, 2);
}

// ── Sin clave no hay identidad: siempre produce ─────────────────────────────────────
{
  let n = 0;
  const prod = async () => { n++; await sleep(5); return 'v'; };
  await Promise.all([dedupe(null, prod), dedupe(null, prod)]);
  check('clave nula → sin deduplicar', n, 2);
}

console.log(bad ? `\ndedupe: ${bad} fallo(s)` : '\ndedupe: 12 comprobaciones OK');
process.exit(bad ? 1 : 0);
