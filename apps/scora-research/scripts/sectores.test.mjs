// El sector de los mayores compradores insider (lib/server/sectores.js).
//   node --experimental-strip-types --no-warnings scripts/sectores.test.mjs
import { sectoresDeFmp } from "../lib/server/sectores.js";

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};
const resp = (status, body) => ({ ok: status < 400, status, json: async () => body });
const PERFILES = { AAPL: [{ symbol: "AAPL", sector: "Technology" }], JPM: [{ symbol: "JPM", sector: "Financial Services" }], VOID: [], BAD: null };

const pedidas = [];
const falso = async (u) => {
  const t = new URL(u).searchParams.get("symbol");
  pedidas.push(t);
  if (t === "BAD") return resp(500, null);
  if (t === "BOOM") throw new Error("red caída");
  return resp(200, PERFILES[t] ?? []);
};

const { sectores, fallos } = await sectoresDeFmp(["AAPL", "JPM", "AAPL", "VOID", "BAD", "BOOM"], { key: "k", fetch: falso, concurrencia: 2 });
check("sector de cada perfil", Object.fromEntries(sectores), { AAPL: "Technology", JPM: "Financial Services" });
check("un ticker repetido se pide una vez", pedidas.filter((t) => t === "AAPL").length, 1);
check("perfil vacío → sin sector, sin fallo", sectores.has("VOID"), false);
check("los fallos se cuentan, no se esconden", fallos.length, 2);
check("y no tumban a los demás", sectores.size, 2);
check("sin tickers no se pide nada", (await sectoresDeFmp([], { key: "k", fetch: falso })).sectores.size, 0);

console.log(bad ? `\n✗ sectores: ${bad} fallo(s) de ${total}` : `\n✓ sectores: ${total} comprobaciones OK`);
process.exit(bad ? 1 : 0);
