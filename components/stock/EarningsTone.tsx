"use client";
import { useState } from "react";
import { aiAnalyzeAudited, authedFetch } from "@/lib/proxy";
import { buildEarningsToneAnalysis } from "@/lib/aiGrounding";
import { Sk } from "@/components/ui/Skeleton";
import { GroundedBadge } from "@/components/ui/GroundedBadge";

// Finnhub transcript shapes (list + detail). Content is premium-gated on the free tier,
// so every field is optional and the caller degrades to the manual paste flow on empty.
interface TranscriptListItem { id?: string; title?: string; time?: string; year?: number; quarter?: number }
interface TranscriptDetail { transcript?: { name?: string; speech?: string[] }[]; title?: string; time?: string }

/** Flatten Finnhub's speaker/speech structure into a single analyzable string. */
function flattenTranscript(d: TranscriptDetail | null): string {
  if (!d?.transcript || !Array.isArray(d.transcript)) return "";
  return d.transcript
    .map(seg => {
      const speech = Array.isArray(seg.speech) ? seg.speech.join(" ") : "";
      return seg.name ? `${seg.name}: ${speech}` : speech;
    })
    .join("\n")
    .trim();
}

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
  const [fetching, setFetching] = useState(false);
  const [callLabel, setCallLabel] = useState<string | null>(null);
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
      setError(e instanceof Error ? e.message : "Failed to analyze");
    }
    setLoading(false);
  }

  async function analyze() {
    if (transcript.trim().length < 200) { setError("Paste the earnings-call transcript (prepared remarks + Q&A) — at least a few paragraphs."); return; }
    await analyzeText(transcript);
  }

  // Auto-pull the latest earnings-call transcript (Finnhub). The endpoint is whitelisted in
  // the proxy but its BODY is premium-gated on the free tier — so on empty/blocked we fall
  // back to the manual paste flow instead of erroring. Never breaks the existing path.
  async function autoFetch() {
    setFetching(true); setError(""); setCallLabel(null);
    try {
      const list = await authedFetch<{ transcripts?: TranscriptListItem[] }>(`/api/finnhub/stock/transcripts/list?symbol=${ticker}`);
      const latest = list?.transcripts?.[0];
      if (!latest?.id) {
        setError("No transcript available for this ticker on the free data tier — paste it below.");
        setOpen(true); return;
      }
      const detail = await authedFetch<TranscriptDetail>(`/api/finnhub/stock/transcripts?id=${encodeURIComponent(latest.id)}`);
      const text = flattenTranscript(detail);
      if (text.length < 200) {
        setError("Transcript body isn't included on the free data tier — paste the call text below.");
        setOpen(true); return;
      }
      setTranscript(text);
      setCallLabel(latest.title || [latest.year, latest.quarter ? `Q${latest.quarter}` : ""].filter(Boolean).join(" ") || "latest call");
      await analyzeText(text);
    } catch {
      setError("Couldn't auto-fetch the transcript — paste it below to analyze.");
      setOpen(true);
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="card">
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>Earnings-call tone · grounded</div>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2, maxWidth: 440, lineHeight: 1.5 }}>
            Scores confidence, Q&amp;A evasiveness and guidance tone, backing every read with a <strong style={{ color: "var(--sr-text-2)" }}>direct quote</strong>. No outside knowledge. Auto-fetch needs Pro-tier transcript data — otherwise paste the text.
            {callLabel && <span style={{ color: "var(--sr-amber)" }}> · {callLabel}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: "var(--sr-sp-2)", flexShrink: 0 }}>
          <button
            onClick={autoFetch}
            disabled={fetching || loading}
            title="Try to auto-fetch the latest transcript (requires Pro-tier data)"
            style={{ padding: "8px 14px", borderRadius: "var(--sr-radius-pill)", fontSize: "var(--sr-t-sm)", fontWeight: 600, cursor: "pointer", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", color: "var(--sr-text-2)" }}
          >
            {fetching ? "Fetching…" : "✦ Auto-fetch"}
          </button>
          <button
            onClick={() => setOpen((o) => !o)}
            className="btn-primary"
            style={{ padding: "8px 14px", fontSize: "var(--sr-t-sm)", fontWeight: 600 }}
          >
            {open ? "Hide" : "Paste transcript"}
          </button>
        </div>
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
            <span className="sr-hint">{transcript.length.toLocaleString()} chars {transcript.length > 16000 ? "(first 16k analyzed)" : ""}</span>
            <button className="btn-primary" onClick={analyze} disabled={loading}>{loading ? "Analyzing…" : "✦ Analyze tone"}</button>
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
