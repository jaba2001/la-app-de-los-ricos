"use client";
import { useState } from "react";
import { aiAnalyze } from "@/lib/proxy";
import { buildEarningsToneAnalysis } from "@/lib/aiGrounding";
import { Sk } from "@/components/ui/Skeleton";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    if (transcript.trim().length < 200) { setError("Paste the earnings-call transcript (prepared remarks + Q&A) — at least a few paragraphs."); return; }
    setLoading(true); setError("");
    try {
      setAnalysis(await aiAnalyze(buildEarningsToneAnalysis(ticker, transcript), 700));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze");
    }
    setLoading(false);
  }

  return (
    <div className="card">
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>Earnings-call tone · grounded</div>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2, maxWidth: 420, lineHeight: 1.5 }}>
            Paste {ticker}&apos;s transcript — the model scores confidence, Q&amp;A evasiveness and guidance tone, backing every read with a <strong style={{ color: "var(--sr-text-2)" }}>direct quote</strong>. No outside knowledge.
          </div>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ flexShrink: 0, padding: "8px 14px", borderRadius: "var(--sr-radius-pill)", fontSize: "var(--sr-t-sm)", fontWeight: 600, cursor: "pointer", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", color: "var(--sr-text-2)" }}
        >
          {open ? "Hide" : "Paste transcript"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: "var(--sr-sp-2)" }}>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={`Paste the ${ticker} earnings-call transcript here (prepared remarks + Q&A)…`}
            rows={6}
            style={{ width: "100%", resize: "vertical", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface)", border: "1px solid var(--sr-border)", color: "var(--sr-text)", fontSize: "var(--sr-t-xs)", lineHeight: 1.5, fontFamily: "inherit", outline: "none" }}
          />
          <div className="sr-flex-between" style={{ marginTop: "var(--sr-sp-2)" }}>
            <span style={{ fontSize: "10px", color: "var(--sr-text-3)" }}>{transcript.length.toLocaleString()} chars {transcript.length > 16000 ? "(first 16k analyzed)" : ""}</span>
            <button className="btn-primary" onClick={analyze} disabled={loading}>{loading ? "Analyzing…" : "✦ Analyze tone"}</button>
          </div>
        </div>
      )}

      {error && <div style={{ marginTop: "var(--sr-sp-2)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{error}</div>}
      {loading && <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "var(--sr-sp-3)" }}>{[85, 60, 78, 55, 70].map((w, i) => <Sk key={i} w={`${w}%`} h={13} />)}</div>}
      {analysis && !loading && (
        <div style={{ fontSize: "var(--sr-t-xs)", lineHeight: 1.65, color: "var(--sr-text-2)", borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-3)", marginTop: "var(--sr-sp-3)" }}>
          {render(analysis)}
        </div>
      )}
    </div>
  );
}
