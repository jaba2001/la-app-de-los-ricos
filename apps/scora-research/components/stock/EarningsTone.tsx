"use client";
import { useState } from "react";
import { aiAnalyzeAudited } from "@/lib/proxy";
import { buildEarningsToneAnalysis } from "@/lib/aiGrounding";
import { Sk } from "@/components/ui/Skeleton";
import { GroundedBadge } from "@/components/ui/GroundedBadge";
import { t } from "@/lib/i18n/cliente";
import Trans from "@/components/Trans";

// La transcripción se PEGA. Hubo un «Auto-fetch» contra Finnhub stock/transcripts, pero con el
// plan de este proyecto ese endpoint responde 403 siempre: era un botón que no funcionaba nunca
// (recorrido con sesión del 12-10-2026). Si se contrata el plan, se recupera de git.
interface Props { ticker: string; }

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

export default function EarningsTone({ ticker }: Props) {
  const [transcript, setTranscript] = useState("");
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [violations, setViolations] = useState<(number | string)[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyzeText(text: string) {
    setLoading(true); setError(""); setViolations([]);
    try {
      // Grounded + audited: the model may only cite figures present in the transcript; the
      // grounding gate flags any it can't verify and the run is logged to the audit trail.
      const res = await aiAnalyzeAudited(buildEarningsToneAnalysis(ticker, text), {
        module: "earnings-tone", ticker, dataBlock: text, sources: ["transcript"], maxTokens: 700,
      });
      setAnalysis(res.text); setViolations(res.violations);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Failed to analyze"));
    }
    setLoading(false);
  }

  async function analyze() {
    if (transcript.trim().length < 200) { setError(t("Paste the earnings-call transcript (prepared remarks + Q&A) — at least a few paragraphs.")); return; }
    await analyzeText(transcript);
  }

  return (
    <div className="card">
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>{t("Earnings-call tone · grounded")}</div>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2, maxWidth: 440, lineHeight: 1.5 }}>
            <Trans text={"Scores confidence, Q&A evasiveness and guidance tone, backing every read with a <s1>direct quote</s1>. No outside knowledge. Paste the call text (prepared remarks + Q&A)."} s1={(c) => <strong style={{ color: "var(--sr-text-2)" }}>{c}</strong>} /></div>
        </div>
        <div style={{ display: "flex", gap: "var(--sr-sp-2)", flexShrink: 0 }}>
          <button
            onClick={() => setOpen((o) => !o)}
            className="btn-primary"
            style={{ padding: "8px 14px", fontSize: "var(--sr-t-sm)", fontWeight: 600 }}
          >
            {open ? t("Hide") : t("Paste transcript")}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: "var(--sr-sp-2)" }}>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={t(`Paste the ${ticker} earnings-call transcript here (prepared remarks + Q&A)…`)}
            rows={6}
            style={{ width: "100%", resize: "vertical", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface)", border: "1px solid var(--sr-border)", color: "var(--sr-text)", fontSize: "var(--sr-t-xs)", lineHeight: 1.5, fontFamily: "inherit", outline: "none" }}
          />
          <div className="sr-flex-between" style={{ marginTop: "var(--sr-sp-2)" }}>
            <span className="sr-hint">{t(`${transcript.length.toLocaleString("en-US")} chars`)}{" "}{transcript.length > 16000 ? t("(first 16k analyzed)") : ""}</span>
            <button className="btn-primary" onClick={analyze} disabled={loading}>{loading ? t("Analyzing…") : t("✦ Analyze tone")}</button>
          </div>
        </div>
      )}

      {error && <div style={{ marginTop: "var(--sr-sp-2)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{error}</div>}
      {loading && <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "var(--sr-sp-3)" }}>{[85, 60, 78, 55, 70].map((w, i) => <Sk key={i} w={`${w}%`} h={13} />)}</div>}
      {analysis && !loading && (
        <div style={{ borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-3)", marginTop: "var(--sr-sp-3)" }}>
          <GroundedBadge violations={violations} />
          <div style={{ fontSize: "var(--sr-t-xs)", lineHeight: 1.65, color: "var(--sr-text-2)" }}>
            {render(analysis)}
          </div>
        </div>
      )}
    </div>
  );
}
