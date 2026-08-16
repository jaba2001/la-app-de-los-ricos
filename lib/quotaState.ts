// Cuánta cuota de IA queda hoy, según la última respuesta del servidor.
//
// POR QUÉ UN ALMACÉN Y NO UNA PETICIÓN PROPIA:
// el proxy ya devuelve el estado en cabeceras (X-Scora-Quota-*) en CADA llamada de IA, así
// que el dato llega gratis. Pedirlo aparte sería una petición de más para saber algo que
// acabamos de recibir, y encima podría contradecir a la respuesta que se está pintando.
//
// Deliberadamente NO es la fuente de la verdad: quien decide es el servidor, que vuelve a
// comprobar la cuota en cada petición. Esto solo sirve para avisar antes de chocarse con el
// límite. Si estuviera desactualizado, lo peor que pasa es que el aviso se vea tarde.
"use client";
import { useSyncExternalStore } from "react";

export interface QuotaState {
  limit: number;
  remaining: number;
  plan: string;
}

let current: QuotaState | null = null;
const listeners = new Set<() => void>();

export function setQuota(next: QuotaState) {
  // Se ignora lo que no tenga sentido en lugar de propagarlo: una cabecera ausente se lee
  // como NaN, y un "quedan NaN" en pantalla es peor que no decir nada.
  if (!Number.isFinite(next.limit) || !Number.isFinite(next.remaining)) return;
  if (current && current.limit === next.limit && current.remaining === next.remaining && current.plan === next.plan) return;
  current = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

const getSnapshot = () => current;
// En el servidor no hay estado: devolver siempre null evita que la hidratación difiera de
// lo que se pintó en el cliente.
const getServerSnapshot = () => null;

/** null mientras no se haya hecho ninguna llamada de IA en esta sesión. */
export function useQuota(): QuotaState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
