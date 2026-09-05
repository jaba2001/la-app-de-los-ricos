"use client";
import { useEffect, useState } from "react";
import type { MacroState } from "@/lib/types";
import { aiAnalyzeAudited } from "@/lib/proxy";
import { buildAllocationBrief } from "@/lib/aiGrounding";
import { fetchKbCards, selectCards, renderKb, type KbCard } from "@/lib/knowledge";
import { Sk } from "@/components/ui/Skeleton";
import { GroundedBadge } from "@/components/ui/GroundedBadge";

interface Props { macro: MacroState | null; }

// Minimal, safe markdown → plain rendering (## headers + **bold**), no HTML injection.
function render(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## ")) {
      return <div key={i} style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: "var(--sr-amber)", marginTop: i ? "var(--sr-sp-3)" : 0, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>{line.slice(3)}</div>;
    }
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith("**") && p.endsWith("**")
        ? <strong key={j} style={{ color: "var(--sr-text)" }}>{p.slice(2, -2)}</strong>
        : <span key={j}>{p}</span>
    );
    return <div key={i} style={{ marginBottom: line.trim() ? 3 : 0 }}>{parts}</div>;
  });
}

export default function ScoraBrief({ macro }: Props) {
  const [brief, setBrief] = useState("");
  const [violations, setViolations] = useState<(number | string)[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cards, setCards] = useState<KbCard[]>([]);

  useEffect(() => { fetchKbCards().then(setCards).catch(() => {}); }, []);

  async function generate() {
    if (!macro) return;
    setLoading(true); setError(""); setViolations([]);
    try {
      const kb = renderKb(selectCards(cards, ["allocation", "regime", "secular", "risk-on", "edge", "methodology"]));
      const prompt = buildAllocationBrief(macro, kb);
      const res = await aiAnalyzeAudited(prompt, { module: "allocation-brief", dataBlock: prompt, sources: ["macro_state", ...(kb ? ["kb"] : [])], maxTokens: 700 });
      setBrief(res.text); setViolations(res.violations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate brief");
    }
    setLoading(false);
  }

  if (!macro) return null;

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>Scora Brief · AI narrator</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, maxWidth: 440, lineHeight: 1.5 }}>
            The validated stack — secular, allocation, correlation — narrated. <strong style={{ color: "var(--sr-text-2)" }}>Grounded</strong>: cites only the real numbers above, never invents.
          </div>
        </div>
        <button className="btn-primary" onClick={generate} disabled={loading} style={{ flexShrink: 0 }}>
          {loading ? "Writing…" : brief ? "Regenerate" : "✦ Generate brief"}
        </button>
      </div>

      {error && (
        <div style={{ padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-sm)" }}>{error}</div>
      )}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-2)" }}>
          {[90, 70, 85, 60, 78, 50].map((w, i) => <Sk key={i} w={`${w}%`} h={14} />)}
        </div>
      )}
      {brief && !loading && (
        <div style={{ borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-3)" }}>
          <GroundedBadge violations={violations} />
          <div style={{ fontSize: "var(--sr-t-sm)", lineHeight: 1.7, color: "var(--sr-text-2)" }}>
            {render(brief)}
          </div>
        </div>
      )}
      {!brief && !loading && !error && (
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", padding: "var(--sr-sp-3) 0" }}>
          A ~180-word read on where we are, what the allocation says, and what would change the view — built only from the Secular Clock, risk-on gauge, and stock-picking regime above.
        </div>
      )}
    </div>
  );
}
