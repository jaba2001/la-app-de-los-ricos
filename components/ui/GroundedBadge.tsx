// Shared governance badge for AI outputs that run through aiAnalyzeAudited. Shows "✓ grounded"
// when the code-level grounding gate found no unverified figures, or lists the flagged ones
// (capped) otherwise. The run is always logged to ai_audit_log. Keeps every AI surface honest
// and consistent — the product's core "AI that can't lie" moat, made visible.

export function GroundedBadge({ violations }: { violations: (number | string)[] }) {
  const n = violations.length;
  const shown = violations.slice(0, 6).join(", ") + (n > 6 ? "…" : "");
  return (
    <div style={{ display: "flex", gap: "var(--sr-sp-2)", flexWrap: "wrap", marginBottom: "var(--sr-sp-2)" }}>
      <span style={{
        fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "var(--sr-radius-pill)",
        background: `color-mix(in srgb, ${n === 0 ? "var(--sr-pos)" : "var(--sr-warn)"} 14%, transparent)`,
        color: n === 0 ? "var(--sr-pos)" : "var(--sr-warn)",
      }}>
        {n === 0 ? "✓ grounded" : `⚠ ${n} unverified figure${n > 1 ? "s" : ""}: ${shown}`}
      </span>
      <span style={{ fontSize: "10px", color: "var(--sr-text-3)", alignSelf: "center" }}>logged to audit trail</span>
    </div>
  );
}
