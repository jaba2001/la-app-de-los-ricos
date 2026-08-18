"use client";
// Modo de lectura: Beginner / Pro.
//
// EL PROBLEMA QUE RESUELVE. La ficha de acción tiene 16 pestañas. Para quien sabe lo que
// busca eso es potencia; para quien acaba de llegar es una pared, y el que se va en los
// primeros treinta segundos no vuelve. Scora contesta bien preguntas que el usuario no ha
// aprendido a hacer todavía — el modo Beginner recorta la superficie hasta lo que sí sabe
// preguntar, sin quitarle nada a quien quiere lo demás.
//
// LO QUE NO HACE: cambiar un solo número. El motor es el mismo en los dos modos, las
// mismas entradas dan la misma llamada. Beginner esconde pestañas, no maquilla resultados
// — un producto que le enseña conclusiones distintas al novato y al experto está mintiendo
// a uno de los dos.
//
// Mismo patrón que lib/horizon.ts: un store externo con useSyncExternalStore, para que
// todos los lectores se muevan a la vez y no haya dos partes de la pantalla en modos
// distintos.

import { useSyncExternalStore } from "react";

export type ReadingMode = "beginner" | "pro";

const KEY = "sr-mode";
const DEFAULT: ReadingMode = "pro";
const VALID: ReadingMode[] = ["beginner", "pro"];

const isMode = (v: unknown): v is ReadingMode => VALID.includes(v as ReadingMode);

let current: ReadingMode | null = null;
const listeners = new Set<() => void>();

function read(): ReadingMode {
  if (current !== null) return current;
  try {
    const saved = localStorage.getItem(KEY);
    current = isMode(saved) ? saved : DEFAULT;
  } catch {
    current = DEFAULT; // SSR / modo privado
  }
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Valor actual sin pasar por React — para llamadas fuera de componentes y para tests. */
export const readMode = read;
/** Suscripción fuera de React. Devuelve la función para darse de baja. */
export const subscribeMode = subscribe;

/** Snapshot de servidor (y del primer render de cliente): siempre el defecto, para que la
 *  hidratación coincida y la preferencia guardada entre en el render siguiente. */
const getServerSnapshot = (): ReadingMode => DEFAULT;

export function setMode(m: ReadingMode): void {
  if (!isMode(m) || m === current) return;
  current = m;
  try { localStorage.setItem(KEY, m); } catch { /* ignorar */ }
  for (const cb of listeners) cb();
}

/** Lee el modo compartido. Todos los componentes que lo usen re-renderizan a la vez. */
export function useMode(): ReadingMode {
  return useSyncExternalStore(subscribe, read, getServerSnapshot);
}

/** Pestañas que ve un principiante, en este orden.
 *
 *  El criterio es "¿responde a una pregunta que ya sabe hacerse?": qué es esta empresa,
 *  está cara, está sana, qué ha hecho el precio, qué dicen las noticias. Lo que queda
 *  fuera (Risk Model, Governance, Options, Screener, Compare, Smart Money, Diligence…) no
 *  es menos importante — es que sin la pregunta detrás, una pestaña más solo es ruido. */
export const BEGINNER_TABS = ["overview", "fundamentals", "valuation", "chart", "news"] as const;

/** ¿Se muestra esta pestaña en el modo activo? */
export function tabVisible(tabId: string, mode: ReadingMode): boolean {
  return mode === "pro" || (BEGINNER_TABS as readonly string[]).includes(tabId);
}

/** Semilla de test — limpia la caché de módulo. */
export function __resetModeForTests(): void {
  current = null;
  listeners.clear();
}
