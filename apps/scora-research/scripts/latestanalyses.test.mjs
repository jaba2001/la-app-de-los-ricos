// Colapso a "la fila mas reciente por ticker" (lib/latestAnalyses.ts).
//   node --experimental-strip-types --no-warnings scripts/latestanalyses.test.mjs
//
// POR QUE EXISTE: hay DOS caminos que tienen que dar el mismo resultado — la vista
// sl_analyses_latest (una fila por ticker, ya colapsada en Postgres) y el respaldo cuando la
// migracion aun no esta aplicada (la tabla entera, colapsada aqui). Si divergen, el usuario
// veria un score distinto segun si el SQL se ha desplegado o no, sin que nada falle. Este
// modulo es el unico sitio donde se decide "cual gana", justamente para que no puedan
// divergir; esto lo comprueba.
import { porTicker } from "../lib/porTicker.ts";

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`FAIL  ${label}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};
const row = (ticker, analysis_date, score_total) => ({ ticker, analysis_date, score_total });

// El respaldo recibe la tabla ordenada por fecha DESC: gana la primera de cada ticker.
{
  const rows = [
    row("AAPL", "2026-09-04", 71), row("AAPL", "2026-08-30", 64), row("AAPL", "2026-07-01", 58),
    row("MSFT", "2026-09-01", 80), row("MSFT", "2026-05-05", 55),
  ];
  const m = porTicker(rows);
  check("dos tickers", Object.keys(m).sort(), ["AAPL", "MSFT"]);
  check("gana la mas reciente de AAPL", m.AAPL.score_total, 71);
  check("gana la mas reciente de MSFT", m.MSFT.score_total, 80);
}

// La vista entrega una sola fila por ticker: mismo resultado, sin depender del orden.
{
  const m = porTicker([row("MSFT", "2026-09-01", 80), row("AAPL", "2026-09-04", 71)]);
  check("vista: mismo mapa", [m.AAPL.score_total, m.MSFT.score_total], [71, 80]);
}

// Bordes.
check("null", porTicker(null), {});
check("vacio", porTicker([]), {});
{
  const m = porTicker([row("AAPL", "2026-09-04", 71)]);
  check("uno solo", m.AAPL.score_total, 71);
}

console.log(bad ? `\nlatestAnalyses: ${bad} fallo(s)` : "\nlatestAnalyses: 7 comprobaciones OK");
process.exit(bad ? 1 : 0);
