"use client";
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/proxy";
import { Sk } from "@/components/ui/Skeleton";

interface NewsItem {
  title: string;
  text?: string;
  publishedDate?: string;
  url?: string;
  site?: string;
}

const CATEGORIES = [
  { id: "rates",        label: "Rates & Fed",        tickers: "TLT,IEF",     composite: "LCC" },
  { id: "credit",       label: "Credit & HY",         tickers: "HYG,LQD",     composite: "CSC" },
  { id: "liquidity",    label: "Liquidity",            tickers: "SPY",          composite: "LCC" },
  { id: "geopolitical", label: "Geopolitical",         tickers: "GLD,USO",      composite: "GRC" },
  { id: "macro",        label: "Macro & Recession",   tickers: "SPY,QQQ",      composite: "RPC" },
  { id: "housing",      label: "Housing",              tickers: "XHB,ITB",      composite: "HSC" },
];

// Keywords per composite for alignment scoring
const KEYWORD_MAP: Record<string, { bullish: string[]; bearish: string[]; neutral: string[] }> = {
  LCC: {
    bullish: ["cut", "easing", "dovish", "qe", "stimulus", "liquidity", "expand", "accommodative"],
    bearish: ["hike", "tighten", "hawkish", "qt", "withdraw", "taper", "reduce balance"],
    neutral: ["fed", "rate", "treasury", "repo", "yield", "fomc", "powell"],
  },
  CSC: {
    bullish: ["tighten", "compress", "narrow", "improve", "upgrade", "recovery"],
    bearish: ["widen", "spread", "default", "stress", "downgrade", "junk", "crisis", "distress"],
    neutral: ["credit", "hy", "ig", "bond", "corporate", "lending", "debt"],
  },
  RPC: {
    bullish: ["expansion", "growth", "hiring", "beat", "strong", "recovery", "resilient"],
    bearish: ["recession", "slowdown", "contraction", "layoff", "unemployment", "weak", "miss", "sahm"],
    neutral: ["gdp", "jobs", "payroll", "employment", "labor", "inflation", "consumer"],
  },
  GRC: {
    bullish: ["ceasefire", "peace", "de-escalate", "stability", "agreement"],
    bearish: ["war", "conflict", "sanction", "escalat", "attack", "crisis", "oil shock", "geopolit"],
    neutral: ["russia", "china", "middle east", "ukraine", "iran", "opec", "commodity"],
  },
  HSC: {
    bullish: ["rise", "increase", "demand", "surge", "appreciation"],
    bearish: ["decline", "fall", "delinquency", "foreclosure", "slow", "weak", "drop"],
    neutral: ["housing", "home", "mortgage", "real estate", "property", "permit", "construction"],
  },
};

interface Alignment {
  composite: string;
  sentiment: "bullish" | "bearish" | "neutral";
  confidence: "HIGH" | "MODERATE" | "LOW";
}

// A bullish keyword next to a concern/negation word isn't bullish: "rate cut fears"
// and "no stimulus" are bearish despite containing "cut"/"stimulus". We only flip
// *bullish* keywords (a bad thing being feared is still bad — "recession fears" stays
// bearish) and use a tight ~12-char window so adjacent-word negation doesn't bleed
// across a whole clause into unrelated keywords. This fixes the main keyword failure
// mode without paying for an LLM classification.
const NEGATORS = [
  "fear", "concern", "risk", "threat", "worry", "worries", "deepen", "worsen", "worse",
  "warn", "doubt", "unlikely", "no ", "not ", "won't", "denies", "denied", "avert",
  "delay", "stall", "despite", "fail", "miss",
];

function bullishNegated(corpus: string, keyword: string): boolean {
  const idx = corpus.indexOf(keyword);
  if (idx === -1) return false;
  const window = corpus.slice(Math.max(0, idx - 12), idx + keyword.length + 12);
  return NEGATORS.some(n => window.includes(n));
}

function computeAlignment(title: string, text: string | undefined, composite: string): Alignment {
  // Title carries the signal; body is supporting context weighted at half.
  const titleLc = title.toLowerCase();
  const bodyLc  = (text ?? "").toLowerCase();
  const corpus  = titleLc + " " + bodyLc;
  const kw = KEYWORD_MAP[composite];
  if (!kw) return { composite, sentiment: "neutral", confidence: "LOW" };

  const hit = (k: string) => (titleLc.includes(k) ? 1 : bodyLc.includes(k) ? 0.5 : 0);

  // Bullish keywords flip to bearish when negated; bearish keywords always count bearish.
  const bull = kw.bullish.reduce((s, k) => {
    const w = hit(k);
    return w === 0 ? s : bullishNegated(corpus, k) ? s - w : s + w;
  }, 0);
  const bear = kw.bearish.reduce((s, k) => s + hit(k), 0);

  const net = bull - bear;
  const magnitude = Math.abs(net);
  const sentiment: "bullish" | "bearish" | "neutral" =
    net > 0.4 ? "bullish" : net < -0.4 ? "bearish" : "neutral";
  const confidence: "HIGH" | "MODERATE" | "LOW" =
    magnitude >= 2 ? "HIGH" : magnitude >= 0.9 ? "MODERATE" : "LOW";

  return { composite, sentiment, confidence };
}

const SENTIMENT_COLORS: Record<string, string> = {
  bullish: "var(--sr-pos)",
  bearish: "var(--sr-neg)",
  neutral: "var(--sr-text-3)",
};

const COMPOSITE_LABELS: Record<string, string> = {
  LCC: "Liquidity",
  CSC: "Credit",
  RPC: "Recession",
  GRC: "Geopolitical",
  HSC: "Housing",
};

function AlignmentBadge({ a }: { a: Alignment }) {
  const color = SENTIMENT_COLORS[a.sentiment];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
      <span style={{
        fontSize: "9px", fontWeight: 700, letterSpacing: "0.05em",
        padding: "2px 6px", borderRadius: "var(--sr-radius-pill)",
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}>{COMPOSITE_LABELS[a.composite] ?? a.composite}</span>
      <span style={{
        fontSize: "9px", fontWeight: 700, padding: "2px 6px",
        borderRadius: "var(--sr-radius-pill)", textTransform: "uppercase",
        background: a.confidence === "HIGH" ? `color-mix(in srgb, ${color} 12%, transparent)` : "var(--sr-surface-3)",
        color: a.confidence === "HIGH" ? color : "var(--sr-text-3)",
      }}>{a.confidence}</span>
      <span style={{ fontSize: "9px", color }}>
        {a.sentiment === "bullish" ? "↑ positive" : a.sentiment === "bearish" ? "↓ negative" : "→ neutral"}
      </span>
    </div>
  );
}

export default function MacroNews() {
  const [active, setActive] = useState("macro");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [sentimentMap, setSentimentMap] = useState<Record<string, { bull: number; bear: number }>>({});

  const cat = CATEGORIES.find(c => c.id === active)!;

  useEffect(() => {
    setLoading(true);
    setNews([]);
    setFetchError("");
    const tickerList = cat.tickers.split(',').map(t => t.trim());
    Promise.allSettled(
      tickerList.map(t => authedFetch<NewsItem[]>(`/api/fmp/news?tickers=${t}&limit=6`))
    ).then(results => {
      const items: NewsItem[] = [];
      results.forEach(r => { if (r.status === "fulfilled" && Array.isArray(r.value)) items.push(...r.value); });
      const unique = Array.from(new Map(items.map(i => [i.title, i])).values()).slice(0, 8);
      setNews(unique);
      setCategoryCounts(prev => ({ ...prev, [active]: unique.length }));
      const alignments = unique.map(it => computeAlignment(it.title, it.text, cat.composite));
      const bull = alignments.filter(a => a.sentiment === "bullish").length;
      const bear = alignments.filter(a => a.sentiment === "bearish").length;
      setSentimentMap(prev => ({ ...prev, [active]: { bull, bear } }));
      setLoading(false);
    }).catch(() => { setFetchError("News temporarily unavailable"); setLoading(false); });
  }, [active, cat.tickers, cat.composite]);

  const currentSentiment = sentimentMap[active];

  return (
    <div className="animate-fade-in">
      <div style={{ display: "flex", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-5)", flexWrap: "wrap" }}>
        {CATEGORIES.map(c => {
          const sm = sentimentMap[c.id];
          return (
            <button key={c.id} className={`subtab ${active === c.id ? "active" : ""}`} onClick={() => setActive(c.id)}>
              {c.label}
              {sm && sm.bear > 0 && (
                <span style={{ marginLeft: 5, fontSize: "9px", color: "var(--sr-neg)", fontWeight: 700 }}>↓{sm.bear}</span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "var(--sr-sp-5)" }}>
        {/* News feed with alignment scoring */}
        <div>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
              {[0,1,2,3].map(i => (
                <div key={i} className="card" style={{ padding: "var(--sr-sp-4)" }}>
                  <Sk w="30%" h={12} /><div style={{ marginTop: 8 }}><Sk w="90%" h={16} /></div>
                  <div style={{ marginTop: 6 }}><Sk w="70%" h={12} /></div>
                </div>
              ))}
            </div>
          ) : fetchError ? (
            <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-8)", color: "var(--sr-neg)" }}>{fetchError}</div>
          ) : news.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>
              No news available for this category.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
              {news.map((item, i) => {
                const alignment = computeAlignment(item.title, item.text, cat.composite);
                const borderColor = alignment.confidence === "HIGH"
                  ? `color-mix(in srgb, ${SENTIMENT_COLORS[alignment.sentiment]} 40%, transparent)`
                  : "var(--sr-border)";
                return (
                  <a
                    key={i}
                    href={item.url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="card"
                    style={{ display: "block", padding: "var(--sr-sp-4)", cursor: "pointer", borderColor, transition: "border-color 160ms" }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--sr-border-2)")}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = borderColor)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>{item.site ?? "Source"}</span>
                      <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
                        {item.publishedDate ? new Date(item.publishedDate).toLocaleDateString("en-US", { month: "short", day: "2-digit" }) : ""}
                      </span>
                    </div>
                    <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 600, color: "var(--sr-text)", lineHeight: 1.4, marginBottom: 4 }}>
                      {item.title}
                    </div>
                    {item.text && (
                      <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.5 }}>
                        {item.text.length > 180 ? item.text.slice(0, 180) + "…" : item.text}
                      </div>
                    )}
                    <AlignmentBadge a={alignment} />
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* Sidebar: velocity + alignment summary */}
        <div>
          <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
            <div className="section-label">News Velocity</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
              <div style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)", textAlign: "center" }}>
                <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{news.length}</div>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>Articles</div>
              </div>
              <div style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)", textAlign: "center" }}>
                <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: "var(--sr-pos)" }}>LIVE</div>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>Status</div>
              </div>
            </div>

            {/* Sentiment split for current category */}
            {currentSentiment != null && news.length > 0 && (
              <div style={{ marginBottom: "var(--sr-sp-3)" }}>
                <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginBottom: 6 }}>
                  {COMPOSITE_LABELS[cat.composite]} Signal Alignment
                </div>
                <div style={{ display: "flex", gap: 6, height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                  <div style={{ flex: currentSentiment.bull, background: "var(--sr-pos)", minWidth: currentSentiment.bull > 0 ? 4 : 0 }} />
                  <div style={{ flex: news.length - currentSentiment.bull - currentSentiment.bear, background: "var(--sr-surface-3)", minWidth: 4 }} />
                  <div style={{ flex: currentSentiment.bear, background: "var(--sr-neg)", minWidth: currentSentiment.bear > 0 ? 4 : 0 }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px" }}>
                  <span style={{ color: "var(--sr-pos)" }}>↑ {currentSentiment.bull} bullish</span>
                  <span style={{ color: "var(--sr-neg)" }}>↓ {currentSentiment.bear} bearish</span>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="section-label">Category Alignment</div>
            <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)", lineHeight: 1.5 }}>
              Each article is scored by keyword mapping to the macro composite (LCC/CSC/RPC/GRC/HSC). Confidence: HIGH = 3+ keywords, MODERATE = 1-2.
            </div>
            {CATEGORIES.map(c => {
              const count = categoryCounts[c.id];
              const sm = sentimentMap[c.id];
              const isActive = c.id === active;
              return (
                <div key={c.id} className="stat-row" style={{ cursor: "pointer" }} onClick={() => setActive(c.id)}>
                  <div>
                    <span style={{ fontSize: "var(--sr-t-sm)", color: isActive ? "var(--sr-amber)" : "var(--sr-text-2)" }}>{c.label}</span>
                    {sm && (
                      <div style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>
                        {sm.bull > 0 && <span style={{ color: "var(--sr-pos)" }}>↑{sm.bull} </span>}
                        {sm.bear > 0 && <span style={{ color: "var(--sr-neg)" }}>↓{sm.bear} </span>}
                        <span style={{ color: "var(--sr-text-3)" }}>→ {COMPOSITE_LABELS[c.composite]}</span>
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 600, color: isActive ? "var(--sr-amber)" : "var(--sr-text-3)" }}>
                    {count != null ? `${count}` : "•"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
