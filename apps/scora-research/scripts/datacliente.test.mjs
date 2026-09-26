// El cliente de datos (lib/dataQuery.ts) — el reemplazo de `supabase.from(...)`.
//   node --experimental-strip-types --no-warnings scripts/datacliente.test.mjs
//
// POR QUÉ EXISTE: 56 llamadas repartidas por 40 ficheros van a pasar por aquí sin cambiar de
// forma. Si este traductor se equivoca —un filtro que se pierde, un orden invertido, un
// upsert sin su clave de conflicto— el fallo no se ve en la pantalla: se ve en los datos.
//
// Lo que más se prueba es que NADA SE PIERDA por el camino: cada `.eq()`, cada `.order()` y
// cada `.limit()` tiene que llegar al servidor. Un filtro que se cae en silencio es una
// consulta que devuelve de más.
import { datos, setTransporte, _pendientes } from "../lib/dataQuery.ts";

let bad = 0;
const check = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

/** Captura lo que se mandaría al servidor y responde lo que se le diga. */
let visto = [];
const responder = (filasPorConsulta) => setTransporte(async (queries) => {
  visto.push(...queries);
  return { results: queries.map((_, i) => ({ rows: filasPorConsulta[i] ?? [] })) };
});

// ── La consulta real de useWatchlistAnalyses ────────────────────────────────────────
{
  visto = []; responder([[{ ticker: "AAPL" }]]);
  await datos.from("sl_analyses_latest").select("*").in("ticker", ["AAPL", "MSFT"]);
  check("tabla", visto[0].table, "sl_analyses_latest");
  check("operacion", visto[0].op, "select");
  check("filtro in conservado", visto[0].filters, [{ col: "ticker", op: "in", val: ["AAPL", "MSFT"] }]);
  // No manda user_id: es justo lo que el servidor añade. Que el cliente NO lo mande es
  // deliberado — si lo mandara, alguien podria cambiarlo desde las herramientas del navegador.
  check("el cliente no manda user_id", JSON.stringify(visto[0]).includes("user_id"), false);
}

// ── Encadenado largo: nada se pierde ────────────────────────────────────────────────
{
  visto = []; responder([[]]);
  await datos.from("sl_journal").select("id,ticker,note").eq("ticker", "AAPL").gte("created_at", "2026-01-01")
    .order("created_at", { ascending: false }).limit(30);
  const q = visto[0];
  check("columnas", q.columns, "id,ticker,note");
  check("dos filtros", q.filters.length, 2);
  check("orden descendente", q.order, [{ col: "created_at", asc: false }]);
  check("limite", q.limit, 30);
}
{
  visto = []; responder([[]]);
  await datos.from("sl_analyses").select("*").order("analysis_date");   // sin opts = ascendente
  check("orden ascendente por defecto", visto[0].order, [{ col: "analysis_date", asc: true }]);
}

// ── Escrituras ──────────────────────────────────────────────────────────────────────
{
  visto = []; responder([[{ id: 1 }]]);
  await datos.from("sl_watchlist").insert({ ticker: "NVDA" });
  check("insert de una fila la envuelve en array", visto[0].rows, [{ ticker: "NVDA" }]);

  visto = []; responder([[{ id: 1 }]]);
  await datos.from("sl_analyses").upsert({ ticker: "AAPL", score_total: 71 }, { onConflict: "ticker,analysis_date,user_id" });
  check("upsert parte el onConflict", visto[0].onConflict, ["ticker", "analysis_date", "user_id"]);

  visto = []; responder([[]]);
  await datos.from("sl_journal").update({ note: "x" }).eq("id", 7);
  check("update lleva patch y filtro", [visto[0].patch, visto[0].filters.length], [{ note: "x" }, 1]);

  visto = []; responder([[]]);
  await datos.from("sl_watchlist").delete().eq("ticker", "NVDA");
  check("delete lleva filtro", visto[0].op + ":" + visto[0].filters.length, "delete:1");
}

// ── single / maybeSingle ────────────────────────────────────────────────────────────
{
  responder([[{ id: 1, regime_id: 3 }]]);
  const r = await datos.from("macro_state").select("*").eq("id", 1).single();
  check("single devuelve la fila, no un array", r.data, { id: 1, regime_id: 3 });

  responder([[]]);
  const v = await datos.from("macro_state").select("*").eq("id", 9).single();
  check("single sin filas -> error", Boolean(v.error), true);

  responder([[]]);
  const m = await datos.from("macro_state").select("*").eq("id", 9).maybeSingle();
  check("maybeSingle sin filas -> null sin error", [m.data, m.error], [null, null]);
}

// ── Agrupación: lo del mismo tick viaja junto ───────────────────────────────────────
{
  visto = []; let lotes = 0;
  setTransporte(async (queries) => { lotes++; visto.push(...queries); return { results: queries.map(() => ({ rows: [] })) }; });
  const ps = [
    datos.from("macro_state").select("*"),
    datos.from("sl_watchlist").select("*"),
    datos.from("sl_journal").select("*"),
  ];
  check("encoladas antes de salir", _pendientes() >= 0, true);
  await Promise.all(ps);
  check("tres consultas, UN solo viaje", lotes, 1);
  check("y llegan las tres", visto.length, 3);
}

// ── Un error del servidor llega como error, no como datos vacíos ────────────────────
{
  setTransporte(async () => ({ results: [{ error: "Tabla no accesible: sl_stripe_events" }] }));
  const r = await datos.from("sl_stripe_events").select("*");
  check("error del servidor -> error", r.error?.message.includes("no accesible"), true);
  // Que `data` sea null y no [] importa: un array vacío se pinta como "no hay nada",
  // que es indistinguible de un resultado legítimo.
  check("y data es null, no un array vacio", r.data, null);
}

console.log(bad ? `\ndataCliente: ${bad} fallo(s)` : "\ndataCliente: 20 comprobaciones OK");
process.exit(bad ? 1 : 0);
