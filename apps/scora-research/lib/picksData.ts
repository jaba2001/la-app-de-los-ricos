// ─────────────────────────────────────────────────────────────────────────────
// Lectura de Scora Picks para la página pública.
//
// Va por REST con la anon key, apoyándose en las políticas de lectura pública de
// `sl_picks_run` y `sl_picks_position`. Desde el SERVIDOR a propósito: el track record es la
// pieza que hace creíble al producto, y un render de cliente le da a un buscador —y a
// cualquiera que comparta el enlace— una página vacía.
//
// Nunca lanza: si la base no responde, la página degrada a su estado vacío. Un track record
// que revienta el render es peor que uno que dice "todavía no hay decisiones".
// ─────────────────────────────────────────────────────────────────────────────
import { PICKS_RULES_VERSION } from "./picks.ts";

const REVALIDATE_SECONDS = 900;

export interface PickPosition {
  ticker: string;
  opened_on: string;
  open_pctl: number;
  open_price: number | null;
  closed_on: string | null;
  close_price: number | null;
  close_reason: string | null;
}

export interface PickRun {
  decision_date: string;
  /** Fecha de la FOTO de miembros del índice usada, que no es `decision_date`: la fuente
   *  gratuita del universo dejó de actualizarse el 2025-08-23. Se publica para que ese
   *  desfase sea visible. Null en filas escritas antes de que la columna existiera. */
  universe_asof: string | null;
  universe_size: number;
  eligible_count: number;
  bought_count: number;
  sold_count: number;
  positions_after: number;
}

async function restGet<T>(path: string): Promise<T | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) return null;
  try {
    const r = await fetch(`${base}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

const V = `rules_version=eq.${PICKS_RULES_VERSION}`;

/** Las posiciones abiertas, de más reciente a más antigua. */
export async function fetchOpenPositions(): Promise<PickPosition[]> {
  return (await restGet<PickPosition[]>(
    `sl_picks_position?${V}&closed_on=is.null&select=ticker,opened_on,open_pctl,open_price,closed_on,close_price,close_reason&order=opened_on.desc`,
  )) ?? [];
}

/** Las cerradas. TODAS: §7 promete publicar también las que salieron mal. */
export async function fetchClosedPositions(): Promise<PickPosition[]> {
  return (await restGet<PickPosition[]>(
    `sl_picks_position?${V}&closed_on=not.is.null&select=ticker,opened_on,open_pctl,open_price,closed_on,close_price,close_reason&order=closed_on.desc`,
  )) ?? [];
}

/** El historial de decisiones, incluidas las fechas en que no se compró nada. */
export async function fetchRuns(limit = 60): Promise<PickRun[]> {
  return (await restGet<PickRun[]>(
    `sl_picks_run?${V}&select=decision_date,universe_asof,universe_size,eligible_count,bought_count,sold_count,positions_after&order=decision_date.desc&limit=${limit}`,
  )) ?? [];
}

/**
 * Las fotos de miembros del índice distintas usadas en un conjunto de decisiones, de más
 * reciente a más antigua. Casi siempre será una sola: la fuente gratuita del universo está
 * congelada. Se publica precisamente por eso — un universo fijo es defendible en un sistema
 * de reglas preregistrado, pero sólo si se dice cuál es.
 *
 * Puro: se testea sin red.
 */
export function universeSnapshots(runs: PickRun[]): string[] {
  const vistos = new Set<string>();
  for (const r of runs) if (r.universe_asof) vistos.add(r.universe_asof);
  return [...vistos].sort().reverse();
}

/** Retorno de una posición cerrada, en %. Null si falta algún precio. */
export function positionReturn(p: PickPosition): number | null {
  if (p.open_price == null || p.close_price == null || p.open_price <= 0) return null;
  return (p.close_price / p.open_price - 1) * 100;
}

export const CLOSE_REASON_LABEL: Record<string, string> = {
  senal_bajo_umbral: "la señal cayó bajo la mediana dos evaluaciones seguidas",
  descalificador: "un pilar entró en el decil inferior de su sector",
  fuera_del_universo: "dejó de cumplir el universo elegible",
};
