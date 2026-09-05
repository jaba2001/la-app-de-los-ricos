import type { StockAnalysis } from "./types";

// Modulo PURO (solo un import de TIPOS, que se borra al compilar), como lib/grounding.ts y
// lib/batchQueue.ts. Vive separado de latestAnalyses.ts por una razon concreta: aquel
// importa el cliente de Supabase y por tanto no se puede cargar en Node sin un bundler,
// asi que la prueba no podria ejecutarlo.
//
// Y esta funcion es justo la que hay que probar: es el UNICO sitio donde se decide que fila
// gana cuando hay varias del mismo ticker, y lo usan los dos caminos —la vista
// sl_analyses_latest y el respaldo contra la tabla—. Si divergieran, el usuario veria un
// score distinto segun si la migracion esta aplicada, sin que nada fallara.

/** Colapsa un historial a la fila mas reciente por ticker. */
export function porTicker(rows: StockAnalysis[] | null): Record<string, StockAnalysis> {
  const map: Record<string, StockAnalysis> = {};
  // Las filas del respaldo vienen ordenadas por fecha descendente, asi que la PRIMERA de
  // cada ticker es la buena. Desde la vista solo hay una por ticker y esto es un no-op.
  (rows ?? []).forEach((a) => { if (!map[a.ticker]) map[a.ticker] = a; });
  return map;
}
