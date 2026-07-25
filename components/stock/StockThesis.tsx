"use client";
import { useEffect, useState } from "react";
import type { MacroState } from "@/lib/types";
import { aiAnalyzeAudited } from "@/lib/proxy";
import { buildStockThesis, type StockThesisInput } from "@/lib/aiGrounding";
import { fetchKbCards, selectCards, renderKb, fetchDocChunks, renderDocChunks, type KbCard, type KbDoc } from "@/lib/knowledge";
import { Sk } from "@/components/ui/Skeleton";
import { GroundedBadge } from "@/components/ui/GroundedBadge";

interface Props { input: StockThesisInput; macro: MacroState | null; }

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

export default function StockThesis({ input, macro }: Props) {
  const [thesis, setThesis] = useState("");
  const [violations, setViolations] = useState<(number | string)[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cards, setCards] = useState<KbCard[]>([]);
  const [docs, setDocs] = useState<KbDoc[]>([]);

  useEffect(() => { fetchKbCards().then(setCards).catch(() => {}); }, []);
  useEffect(() => { fetchDocChunks(input.ticker).then(setDocs).catch(() => setDocs([])); }, [input.ticker]);

  async function generate() {
    setLoading(true); setError(""); setViolations([]);
    try {
      const kb = renderKb(selectCards(cards, ["momentum", "stock-picking", "correlation", "edge"]));
      const filings = renderDocChunks(docs);
      const prompt = buildStockThesis(input, macro, kb, filings);
      const sources = [...docs.map((d) => `${d.form} ${d.section}`), ...(kb ? ["kb"] : [])];
      // dataBlock = the full prompt: any figure the model outputs that isn't in its input is flagged.
      const res = await aiAnalyzeAudited(prompt, { module: "stock-thesis", ticker: input.ticker, dataBlock: prompt, sources, maxTokens: 700 });
      setThesis(res.text); setViolations(res.violations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate thesis");
    }
    setLoading(false);
  }

  return (
    <div className="card">
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>AI thesis · grounded</div>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2 }}>
            Cites only {input.ticker}&apos;s computed metrics — no invented numbers.
            {docs.length > 0 && <span style={{ color: "var(--sr-pos)", marginLeft: 4 }}>· Grounded in 10-K{docs[0].fiscal_year ? ` FY${docs[0].fiscal_year}` : ""} ({docs.map((d) => d.section).join(", ")})</span>}
          </div>
        </div>
        <button className="btn-primary" onClick={generate} disabled={loading} style={{ flexShrink: 0 }}>
          {loading ? "Writing…" : thesis ? "Regenerate" : "✦ Generate"}
        </button>
      </div>
      {error && <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{error}</div>}
      {loading && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{[85, 65, 80, 55].map((w, i) => <Sk key={i} w={`${w}%`} h={13} />)}</div>}
      {thesis && !loading && (
        <div style={{ borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-3)" }}>
          <GroundedBadge violations={violations} />
          <div style={{ fontSize: "var(--sr-t-xs)", lineHeight: 1.65, color: "var(--sr-text-2)" }}>
            {render(thesis)}
          </div>
        </div>
      )}
    </div>
  );
}
