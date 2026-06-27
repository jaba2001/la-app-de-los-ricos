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
  { id: "rates",       label: "Rates & Fed",         tickers: "TLT,IEF,FED" },
  { id: "credit",      label: "Credit & HY",          tickers: "HYG,LQD" },
  { id: "liquidity",   label: "Liquidity & Balance",  tickers: "SPY,FED" },
  { id: "geopolitical",label: "Geopolitical",          tickers: "GLD,USO,OIL" },
  { id: "macro",       label: "Macro & Recession",    tickers: "SPY,QQQ" },
  { id: "housing",     label: "Housing",              tickers: "XHB,ITB" },
];

export default function MacroNews() {
  const [active, setActive] = useState("macro");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});

  const cat = CATEGORIES.find(c => c.id === active)!;

  useEffect(() => {
    setLoading(true);
    setNews([]);
    setFetchError("");
    authedFetch<NewsItem[]>(`/api/fmp/news?tickers=${cat.tickers}&limit=8`)
      .then(r => {
        const items = Array.isArray(r) ? r : [];
        setNews(items);
        setCategoryCounts(prev => ({ ...prev, [active]: items.length }));
        setLoading(false);
      })
      .catch(e => { setFetchError(e instanceof Error ? e.message : "Failed to load news"); setLoading(false); });
  }, [active, cat.tickers]);

  return (
    <div className="animate-fade-in">
      {/* Category tabs */}
      <div style={{ display: "flex", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-5)", flexWrap: "wrap" }}>
        {CATEGORIES.map(c => (
          <button key={c.id} className={`subtab ${active === c.id ? "active" : ""}`} onClick={() => setActive(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "var(--sr-sp-5)" }}>
        {/* News feed */}
        <div>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
              {[0,1,2,3,4].map(i => (
                <div key={i} className="card" style={{ padding: "var(--sr-sp-4)" }}>
                  <Sk w="30%" h={12} />
                  <div style={{ marginTop: 8 }}><Sk w="90%" h={16} /></div>
                  <div style={{ marginTop: 6 }}><Sk w="70%" h={12} /></div>
                </div>
              ))}
            </div>
          ) : fetchError ? (
            <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-8)", color: "var(--sr-neg)" }}>
              {fetchError}
            </div>
          ) : news.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>
              No news available for this category.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
              {news.map((item, i) => (
                <a
                  key={i}
                  href={item.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="card"
                  style={{
                    display: "block",
                    padding: "var(--sr-sp-4)",
                    transition: "border-color 160ms",
                    cursor: "pointer",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--sr-border-2)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--sr-border)")}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>{item.site ?? "Source"}</span>
                    <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
                      {item.publishedDate ? new Date(item.publishedDate).toLocaleDateString("en-US", { month: "short", day: "2-digit" }) : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 600, color: "var(--sr-text)", lineHeight: 1.4, marginBottom: 6 }}>
                    {item.title}
                  </div>
                  {item.text && (
                    <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.5 }}>
                      {item.text.length > 180 ? item.text.slice(0, 180) + "…" : item.text}
                    </div>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* News summary panel */}
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
          </div>

          <div className="card">
            <div className="section-label">Category Alignment</div>
            {CATEGORIES.map(c => {
              const count = categoryCounts[c.id];
              const isActive = c.id === active;
              return (
                <div
                  key={c.id}
                  className="stat-row"
                  style={{ cursor: "pointer" }}
                  onClick={() => setActive(c.id)}
                >
                  <span style={{ fontSize: "var(--sr-t-sm)", color: isActive ? "var(--sr-amber)" : "var(--sr-text-2)" }}>
                    {c.label}
                  </span>
                  <span style={{
                    fontSize: "var(--sr-t-xs)", fontWeight: 600,
                    color: isActive ? "var(--sr-amber)" : count != null ? "var(--sr-text-2)" : "var(--sr-text-3)",
                  }}>
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
