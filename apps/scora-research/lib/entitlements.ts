// Quién tiene Pro. El ÚNICO sitio del front donde se responde esa pregunta.
//
// POR QUÉ UN SOLO PUNTO:
// la alternativa natural es un `if (sub?.status === "active")` allí donde haga falta. Con
// tres pantallas ya hay tres definiciones distintas de "Pro" y la cuarta se olvida de
// `trialing`, así que quien está de prueba ve la mitad del producto. Peor: cuando cambie la
// política —dar o no acceso en `past_due`, respetar el periodo ya pagado tras cancelar— hay
// que encontrar todos los sitios, y el que se escape es un fallo silencioso a favor o en
// contra del cliente. Aquí se cambia una vez.
//
// LÍMITE DE LO QUE ESTO GARANTIZA — importa entenderlo:
// esto es comodidad de interfaz, NO una barrera de seguridad. Corre en el navegador y
// cualquiera puede saltárselo con las herramientas de desarrollo. Sirve para enseñar u
// ocultar botones. Todo lo que cueste dinero de verdad (llamadas al modelo, envíos) tiene
// que comprobarse otra vez en el servidor, contra la misma tabla — ver
// lib/server/entitlements.js. Aquí decidimos qué se ENSEÑA; allí, qué se PERMITE.
"use client";
import { useCallback, useEffect, useState } from "react";
import { datos } from "./dataClient";
import { useAuth } from "./auth";

export interface Subscription {
  status: string;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

/**
 * Estados que dan acceso. Espejo de PRO_STATUSES en lib/server/stripe.js — si cambia uno,
 * cambia el otro, o el front y el servidor discreparán sobre quién ha pagado.
 *
 * `past_due` mantiene el acceso: Stripe reintenta el cobro durante días y cortar al primer
 * fallo castiga sobre todo a quien se le ha caducado la tarjeta. Cuando agote los reintentos
 * pasará a `canceled` o `unpaid`, y entonces sí.
 */
const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Decisión pura: fácil de probar y de leer sin seguir el hilo de un hook. */
export function isProSubscription(sub: Subscription | null): boolean {
  if (!sub) return false;
  if (!PRO_STATUSES.has(sub.status)) return false;
  // Cancelar no corta al instante: se ha pagado hasta el final del periodo y hasta ahí llega
  // el acceso. Stripe pondrá `canceled` cuando toque; esta comprobación cubre la ventana en
  // la que el webhook aún no ha llegado y evita quitar algo que está pagado.
  if (sub.current_period_end && Date.parse(sub.current_period_end) < Date.now()) return false;
  return true;
}

interface Entitlements {
  isPro: boolean;
  /** true mientras no se sabe. Sirve para no parpadear de "Pro" a "Free" al cargar. */
  loading: boolean;
  subscription: Subscription | null;
  /**
   * Vuelve a leer la suscripción.
   *
   * Existe por el hueco de después de pagar: Stripe devuelve al usuario a la app en cuanto
   * cobra, pero el webhook que escribe la fila llega por otro camino y puede tardar unos
   * segundos. Sin poder releer, el que acaba de pagar vuelve y ve "Free" — y su siguiente
   * gesto es pedir la devolución o pagar dos veces.
   */
  refresh: () => void;
}

export function useEntitlements(): Entitlements {
  const { session, loading: authLoading } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const userId = session?.user?.id ?? null;
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) { setSub(null); setLoading(false); return; }

    let cancelled = false;
    datos
      .from("sl_subscriptions")
      .select("status,price_id,current_period_end,cancel_at_period_end")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setSub((data as Subscription) ?? null);
        setLoading(false);
      })
      // Sin fila, sin tabla (despliegue anterior a la migración) o RLS negando: todo eso es
      // "no es Pro", no un error que enseñar. Que el producto siga funcionando gratis cuando
      // la capa de pago falla es deliberado: lo contrario deja fuera a los usuarios gratuitos
      // por una avería del sistema de cobro, que es a quienes menos les incumbe.
      .then(undefined, () => { if (!cancelled) { setSub(null); setLoading(false); } });

    return () => { cancelled = true; };
  }, [userId, authLoading, nonce]);

  return { isPro: isProSubscription(sub), loading: authLoading || loading, subscription: sub, refresh };
}
