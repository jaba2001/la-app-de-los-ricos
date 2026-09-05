import { supabase } from "./supabase";
import type { StockAnalysis } from "./types";
import { porTicker } from "./porTicker";

// El análisis más reciente de cada ticker, indexado por ticker.
//
// POR QUÉ EXISTE: cinco pantallas hacían exactamente lo mismo —pedir el historial completo
// de una lista de tickers y quedarse en JavaScript con la primera fila de cada uno—. Eso
// descarga N filas para pintar una: invisible con 22 análisis en la tabla, cada vez más
// lento a medida que se usa el producto. La vista sl_analyses_latest hace ese trabajo en
// Postgres, que es donde están los datos y el índice.
//
// DEGRADA A PROPÓSITO: si la vista todavía no existe (migración sin aplicar), se cae a la
// consulta de siempre en vez de dejar cinco pantallas en blanco. Así el orden de despliegue
// deja de ser crítico: se puede subir este código antes que el SQL y lo único que pasa es
// que sigue yendo como antes hasta que la migración entra.

export async function latestAnalyses(tickers: string[]): Promise<Record<string, StockAnalysis>> {
  if (!tickers.length) return {};

  const { data, error } = await supabase
    .from("sl_analyses_latest")
    .select("*")
    .in("ticker", tickers);

  if (!error) return porTicker(data as StockAnalysis[] | null);

  // Respaldo: la tabla completa, como antes de existir la vista.
  const { data: rows } = await supabase
    .from("sl_analyses")
    .select("*")
    .in("ticker", tickers)
    .order("analysis_date", { ascending: false });
  return porTicker(rows as StockAnalysis[] | null);
}
