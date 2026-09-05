"use client";
// Shared holding-period preference.
//
// The horizon re-weights the verdict, and it is read in more than one place (the
// answer-first bar and the top-down panel below it). Local state in each component would
// let them drift apart and show two different calls for the same name on the same screen,
// which is exactly the failure `lib/verdict.ts` exists to prevent. One external store,
// subscribed via `useSyncExternalStore`, keeps every reader on the same value.

import { useSyncExternalStore } from "react";
import { type Horizon } from "./rating.ts";

const KEY = "sr-horizon";
const DEFAULT: Horizon = "months";
const VALID: Horizon[] = ["days", "months", "years"];

const isHorizon = (v: unknown): v is Horizon => VALID.includes(v as Horizon);

let current: Horizon | null = null;
const listeners = new Set<() => void>();

function read(): Horizon {
  if (current !== null) return current;
  try {
    const saved = localStorage.getItem(KEY);
    current = isHorizon(saved) ? saved : DEFAULT;
  } catch {
    current = DEFAULT; // SSR / privacy mode
  }
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Current value without a React render — for non-component callers and tests. */
export const readHorizon = read;
/** Subscribe outside React. Returns an unsubscribe function. */
export const subscribeHorizon = subscribe;

/** Server (and first client) snapshot: always the default, so hydration matches and the
 *  stored preference is applied on the subsequent client render. */
const getServerSnapshot = (): Horizon => DEFAULT;

export function setHorizon(h: Horizon): void {
  if (!isHorizon(h) || h === current) return;
  current = h;
  try { localStorage.setItem(KEY, h); } catch { /* ignore */ }
  for (const cb of listeners) cb();
}

/** Read the shared horizon. Every component using this re-renders together on change. */
export function useHorizon(): Horizon {
  return useSyncExternalStore(subscribe, read, getServerSnapshot);
}

/** Test seam — resets the module-level cache. */
export function __resetHorizonForTests(): void {
  current = null;
  listeners.clear();
}
