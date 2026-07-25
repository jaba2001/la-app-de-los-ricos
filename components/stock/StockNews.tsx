"use client";
import { useEffect, useState } from "react";
import { aiAnalyzeAudited, authedFetch } from "@/lib/proxy";
import { buildNewsRelevance, type NewsHeadline } from "@/lib/aiGrounding";
import { Sk } from "@/components/ui/Skeleton";
import { GroundedBadge } from "@/components/ui/GroundedBadge";

interface Props { ticker: string }
interface RawNews { datetime?: number; headline?: string; source?: string; summary?: string; url?: string; category?: string }

function fmtDate(unixSec?: number): string {
  if (!unixSec) return "";
  const d = new Date(unixSec * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// Shared renderer for the grounded AI output (## sections + **bold**), mirrors EarningsTone.
function renderAI(text: string) {
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

export default function StockNews({ ticker }: Props) {
  const [news, setNews] = useState<RawNews[]>([]);
  const [loadingNews, setLoadingNews] = useState(true);
  const [analysis, setAnalysis] = useState("");
  const [violations, setViolations] = useState<(number | string)[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setLoadingNews(true); setAnalysis(""); setError("");
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    authedFetch<RawNews[]>(`/api/finnhub/company-news?symbol=${ticker}&from=${from}&to=${to}`)
      .then(rows => {
        if (!live) return;
        const clean = (Array.isArray(rows) ? rows : [])
          .filter(r => r.headline)
          .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
          .slice(0, 30);
        setNews(clean);
      })
      .catch(() => { if (live) setNews([]); })
      .finally(() => { if (live) setLoadingNews(false); });
    return () => { live = false; };
  }, [ticker]);

  async function analyze() {
    if (news.length === 0) return;
    setAnalyzing(true); setError(""); setViolations([]);
    try {
      const items: NewsHeadline[] = news.slice(0, 20).map(n => ({
        headline: n.headline ?? "",
        summary: n.summary,
        source: n.source,
        datetime: fmtDate(n.datetime),
      }));
      // dataBlock = the exact items the model may use → the grounding gate flags any figure
      // it introduces that isn't in the headlines/summaries; the run is logged to the audit trail.
      const dataBlock = items.map((it, i) => `${i + 1}. ${it.headline}${it.summary ? " — " + it.summary : ""}`).join("\n");
      const sources = [...new Set(news.slice(0, 20).map(n => n.source).filter((s): s is string => !!s))];
      const res = await aiAnalyzeAudited(buildNewsRelevance(ticker, items), {
        module: "news-relevance", ticker, dataBlock, sources, maxTokens: 700,
      });
      setAnalysis(res.text); setViolations(res.violations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze news");
    }
    setAnalyzing(false);
  }

  return (
    <div className="animate-fade-in">
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
          <div>
            <div className="section-label" style={{ margin: 0 }}>News relevance · grounded</div>
            <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2, maxWidth: 460, lineHeight: 1.5 }}>
              Sorts {ticker}&apos;s last two weeks of headlines into <strong style={{ color: "var(--sr-text-2)" }}>market-moving vs noise</strong> with sentiment — using only the headlines, no invented facts.
            </div>
          </div>
          <button className="btn-primary" onClick={analyze} disabled={analyzing || loadingNews || news.length === 0} style={{ flexShrink: 0, padding: "8px 14px", fontSize: "var(--sr-t-sm)", fontWeight: 600 }}>
            {analyzing ? "Analyzing…" : "✦ Filter what matters"}
          </button>
        </div>
        {error && <div style={{ marginTop: "var(--sr-sp-2)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{error}</div>}
        {analyzing && <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "var(--sr-sp-3)" }}>{[85, 60, 78, 55, 70].map((w, i) => <Sk key={i} w={`${w}%`} h={13} />)}</div>}
        {analysis && !analyzing && (
          <div style={{ borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-3)", marginTop: "var(--sr-sp-3)" }}>
            <GroundedBadge violations={violations} />
            <div style={{ fontSize: "var(--sr-t-xs)", lineHeight: 1.65, color: "var(--sr-text-2)" }}>
              {renderAI(analysis)}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-label">Recent headlines — {ticker}</div>
        {loadingNews ? <Sk w="100%" h={240} /> : news.length === 0 ? (
          <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)", padding: "var(--sr-sp-4) 0" }}>No recent news for {ticker}.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {news.map((n, i) => (
              <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
                 style={{ display: "flex", gap: "var(--sr-sp-3)", padding: "var(--sr-sp-3) 0", borderBottom: i < news.length - 1 ? "1px solid var(--sr-border)" : "none", textDecoration: "none", color: "inherit" }}>
                <span className="num" style={{ flexShrink: 0, fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", width: 36 }}>{fmtDate(n.datetime)}</span>
                <div>
                  <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text)", lineHeight: 1.4 }}>{n.headline}</div>
                  <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2 }}>{n.source}</div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
