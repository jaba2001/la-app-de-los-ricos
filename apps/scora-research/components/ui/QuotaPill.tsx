"use client";
// Cuántos análisis de IA quedan hoy.
//
// Aparece SOLO después de la primera llamada de IA de la sesión, porque hasta entonces el
// dato no existe (llega en las cabeceras de la propia respuesta, ver lib/quotaState.ts).
// Es deliberado: un contador vacío o a la espera en la barra superior distrae, y a quien
// nunca usa la IA no le importa el límite. En cuanto la usa, empieza a hacerle falta.
//
// No cuenta con quedarse al día por sí solo — es un aviso, no la autoridad. Quien decide es
// el servidor, que vuelve a comprobar la cuota en cada petición.
import { useRouter } from "next/navigation";
import { useQuota } from "@/lib/quotaState";

export default function QuotaPill() {
  const quota = useQuota();
  const router = useRouter();
  if (!quota) return null;

  const { remaining, limit, plan } = quota;
  const agotado = remaining <= 0;
  const escaso = remaining > 0 && remaining <= Math.max(1, Math.floor(limit * 0.25));
  // Solo a un usuario gratuito tiene sentido ofrecerle subir de plan.
  const puedeSubir = plan !== "pro" && (agotado || escaso);

  const color = agotado ? "var(--sr-neg)" : escaso ? "var(--sr-amber)" : "var(--sr-text-3)";

  return (
    <button
      onClick={() => puedeSubir && router.push("/pricing")}
      // Sin acción posible no debe parecer pulsable, ni recibir foco del teclado.
      disabled={!puedeSubir}
      title={
        agotado
          ? `Sin análisis de IA hasta las 00:00 UTC${puedeSubir ? " — Pro amplía el límite" : ""}`
          : `${remaining} de ${limit} análisis de IA restantes hoy (se reinicia a las 00:00 UTC)`
      }
      style={{
        flexShrink: 0,
        display: "flex", alignItems: "center", gap: 6,
        background: agotado || escaso ? `color-mix(in srgb, ${color} 12%, transparent)` : "transparent",
        border: `1px solid ${agotado || escaso ? `color-mix(in srgb, ${color} 40%, transparent)` : "var(--sr-border)"}`,
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: "10px",
        color,
        cursor: puedeSubir ? "pointer" : "default",
        fontFamily: "inherit",
      }}
    >
      <span style={{ opacity: 0.75 }}>AI</span>
      <span className="num" style={{ fontWeight: 700 }}>
        {Math.max(0, remaining)}/{limit}
      </span>
      {puedeSubir && <span style={{ opacity: 0.9 }}>· Upgrade</span>}
    </button>
  );
}
