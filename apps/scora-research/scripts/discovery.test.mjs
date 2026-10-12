// El screener de /discovery enseña solo el ranking de la última ejecución (lib/discovery.ts).
//   node --experimental-strip-types --no-warnings scripts/discovery.test.mjs
import { ultimaTanda } from "../lib/discovery.ts";

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

// El caso real: el top de esta semana y restos de semanas anteriores con rangos repetidos.
const filas = [
  { ticker: "NVDA", rank: 1, updated_at: "2026-10-05T13:04:10.120Z" },
  { ticker: "AVGO", rank: 2, updated_at: "2026-10-05T13:04:10.121Z" },
  { ticker: "OLD1", rank: 2, updated_at: "2026-09-28T13:03:00.000Z" },
  { ticker: "OLD2", rank: 54, updated_at: "2026-07-09T13:00:00.000Z" },
];
check("solo la última tanda", ultimaTanda(filas).map((f) => f.ticker), ["NVDA", "AVGO"]);
check("sin rangos repetidos", new Set(ultimaTanda(filas).map((f) => f.rank)).size, ultimaTanda(filas).length);
check("vacío → vacío", ultimaTanda([]), []);
check("sin fechas → no se esconde nada", ultimaTanda([{ ticker: "A" }, { ticker: "B", updated_at: null }]).length, 2);
check("una ejecución que cruza medianoche sigue entera",
  ultimaTanda([{ ticker: "A", updated_at: "2026-10-05T23:59:59Z" }, { ticker: "B", updated_at: "2026-10-06T00:00:30Z" }]).length, 2);

console.log(bad ? `\n✗ discovery: ${bad} fallo(s) de ${total}` : `\n✓ discovery: ${total} comprobaciones OK`);
process.exit(bad ? 1 : 0);
