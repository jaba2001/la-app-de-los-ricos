// Reintento ante fallos de red de los proveedores (lib/server/providers/red.js).
//   node --experimental-strip-types --no-warnings scripts/red.test.mjs
import { fetchConReintento } from "../lib/server/providers/red.js";

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};
const secuencia = (...pasos) => { let n = 0; const f = async () => { const p = pasos[Math.min(n++, pasos.length - 1)]; if (p instanceof Error) throw p; return p; }; f.llamadas = () => n; return f; };
const red = () => new TypeError("fetch failed");

{
  const f = secuencia(red(), { status: 200 });
  check("un parpadeo de red → segundo intento", (await fetchConReintento("u", {}, { fetch: f, esperaMs: 1 })).status, 200);
  check("dos llamadas", f.llamadas(), 2);
}
{
  const f = secuencia({ status: 429 }, { status: 200 });
  check("una respuesta de error NO se repite (gastaría cuota)", (await fetchConReintento("u", {}, { fetch: f, esperaMs: 1 })).status, 429);
  check("una sola llamada", f.llamadas(), 1);
}
{
  const f = secuencia(red(), red(), { status: 200 });
  const r = await fetchConReintento("u", {}, { fetch: f, esperaMs: 1 }).then(() => "resolvió", (e) => e.message);
  check("si la red sigue caída, el error sale (no se inventa una respuesta)", r, "fetch failed");
  check("con el número de intentos pedido", f.llamadas(), 2);
}

console.log(bad ? `\n✗ red: ${bad} fallo(s) de ${total}` : `\n✓ red: ${total} comprobaciones OK`);
process.exit(bad ? 1 : 0);
