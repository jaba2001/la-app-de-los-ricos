"use client";
// Aviso de consentimiento para la analítica (AUDIT_REPORT A-6).
//
// Solo aparece si hay analítica configurada y la persona no ha elegido todavía. Aceptar y
// rechazar pesan lo mismo a propósito: un "Rechazar" escondido no es un consentimiento libre.
import { useState, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/auth";
import { analyticsConfigured, leerConsentimiento, guardarConsentimiento, identify } from "@/lib/analytics";

// La elección vive en localStorage, que no avisa de cambios en la misma pestaña: la
// suscripción no hace nada y el cierre del aviso lo lleva el estado local de abajo.
const sinSuscripcion = () => () => {};

export default function ConsentBanner() {
  const { session } = useAuth();
  // En el servidor no hay localStorage: "servidor" hace que no se pinte nada en el HTML, así
  // que a quien ya eligió no le parpadea el aviso al hidratar.
  const eleccion = useSyncExternalStore(sinSuscripcion, leerConsentimiento, () => "servidor" as const);
  const [cerrado, setCerrado] = useState(false);

  if (cerrado || eleccion !== null || !analyticsConfigured()) return null;

  const elegir = (v: "si" | "no") => {
    guardarConsentimiento(v);
    // Quien ya tenía sesión no pasa otra vez por el `identify` de AnalyticsProvider.
    if (v === "si" && session?.user?.id) identify(session.user.id);
    setCerrado(true);
  };

  const boton = {
    border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)", padding: "8px 16px",
    fontWeight: 600, fontSize: "var(--sr-t-sm)", cursor: "pointer", background: "var(--sr-surface-2)", color: "var(--sr-text)",
  } as const;

  return (
    <div role="dialog" aria-label="Analytics consent" style={{
      position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 1000, maxWidth: 640, margin: "0 auto",
      background: "var(--sr-surface)", border: "1px solid var(--sr-border-2, var(--sr-border))",
      borderRadius: "var(--sr-radius-lg, 14px)", padding: "var(--sr-sp-4)", boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
    }}>
      <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.6, margin: "0 0 var(--sr-sp-3)" }}>
        We&apos;d like to use product analytics (PostHog, EU servers) to see which features get used.
        It stores a cookie and an ID on your device. Nothing is sent unless you accept, and the
        app works the same either way.
      </p>
      <div style={{ display: "flex", gap: "var(--sr-sp-2)", justifyContent: "flex-end" }}>
        <button style={boton} onClick={() => elegir("no")}>Decline</button>
        <button style={boton} onClick={() => elegir("si")}>Accept</button>
      </div>
    </div>
  );
}
