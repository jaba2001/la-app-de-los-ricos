
import { t } from "@/lib/i18n/cliente";// Shared governance badge for AI outputs that run through aiAnalyzeAudited. Shows "✓ grounded"
// when the code-level grounding gate found no unverified figures, or lists the flagged ones
// (capped) otherwise. The run is always logged to ai_audit_log. Keeps every AI surface honest
// and consistent — the product's core "AI that can't lie" moat, made visible.
//
// Y dice, antes que nada, que el texto lo ha generado una IA: la Ley de IA (art. 50.1, aplicable
// desde el 02-08-2026) obliga a informarlo salvo que sea obvio, y la excepción se lee estrecha.
// Como TODAS las salidas de IA de la app pasan por este distintivo, el aviso vive aquí una sola
// vez (plan único, pieza 1.2 d). El asistente de pantalla lleva además su propio aviso.

/** «Generado con IA»: la etiqueta del art. 50.1. La usan este distintivo y los que se pintan a
 *  mano (DueDiligence), para que el aviso tenga una sola implementación. */
export function EtiquetaIA() {
  return (
    <span style={{
      fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "var(--sr-radius-pill)",
      background: "var(--sr-surface-2)", color: "var(--sr-text-2)", border: "1px solid var(--sr-border)",
    }}>
      {t("AI-generated")}
    </span>
  );
}

export function GroundedBadge({ violations }: { violations: (number | string)[] }) {
  const n = violations.length;
  const shown = violations.slice(0, 6).join(", ") + (n > 6 ? "…" : "");
  return (
    <div style={{ display: "flex", gap: "var(--sr-sp-2)", flexWrap: "wrap", marginBottom: "var(--sr-sp-2)" }}>
      <EtiquetaIA />
      <span style={{
        fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "var(--sr-radius-pill)",
        background: `color-mix(in srgb, ${n === 0 ? "var(--sr-pos)" : "var(--sr-warn)"} 14%, transparent)`,
        color: n === 0 ? "var(--sr-pos)" : "var(--sr-warn)",
      }}>
        {n === 0 ? t("✓ grounded") : t(`⚠ ${n} unverified figure${n > 1 ? "s" : ""}: ${shown}`)}
      </span>
      <span style={{ fontSize: "10px", color: "var(--sr-text-3)", alignSelf: "center" }}>{t("logged to audit trail")}</span>
    </div>
  );
}
