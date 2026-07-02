"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useMacroContext } from "@/lib/MacroContext";
import dynamic from "next/dynamic";
import type { MacroState } from "@/lib/types";
import { Sk } from "@/components/ui/Skeleton";

const TabSk = () => <Sk w="100%" h={400} />;

const MacroOverview   = dynamic(() => import("@/components/macro/MacroOverview"),   { loading: TabSk, ssr: false });
const MacroIndicators = dynamic(() => import("@/components/macro/MacroIndicators"), { loading: TabSk, ssr: false });
const MacroMarkets    = dynamic(() => import("@/components/macro/MacroMarkets"),    { loading: TabSk, ssr: false });
const MacroMonitors   = dynamic(() => import("@/components/macro/MacroMonitors"),   { loading: TabSk, ssr: false });
const MacroNews       = dynamic(() => import("@/components/macro/MacroNews"),       { loading: TabSk, ssr: false });
const MacroAI         = dynamic(() => import("@/components/macro/MacroAI"),         { loading: TabSk, ssr: false });
const MacroPortfolio  = dynamic(() => import("@/components/macro/MacroPortfolio"),  { loading: TabSk, ssr: false });
const MacroHistoricalAnalog = dynamic(() => import("@/components/macro/MacroHistoricalAnalog"), { loading: TabSk, ssr: false });

const TABS = [
  { id: "overview",    label: "Overview" },
  { id: "indicators",  label: "Indicators" },
  { id: "markets",     label: "Markets" },
  { id: "monitors",    label: "Monitors" },
  { id: "analog",      label: "Historical Analog" },
  { id: "portfolio",   label: "Portfolio" },
  { id: "news",        label: "News" },
  { id: "ai",          label: "AI Synthesis" },
  { id: "raw",         label: "Raw Data" },
];

export default function MacroPage() {
  const { session, loading: authLoading } = useAuth();
  const { macro: contextMacro, setMacro: setMacroContext } = useMacroContext();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("overview");
  const [macro, setMacro] = useState<MacroState | null>(contextMacro);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(!!contextMacro);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !session) router.replace("/login");
  }, [session, authLoading, router]);

  async function loadData() {
    if (!session) return;
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase
      .from("macro_state")
      .select("*")
      .eq("id", 1)
      .single();
    if (err) { setError(err.message); }
    else {
      setMacro(data as MacroState);
      setMacroContext(data as MacroState);
      setHasLoaded(true);
    }
    setLoading(false);
  }

  if (authLoading || !session) return null;

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Sub-nav */}
      <div style={{
        position: "sticky",
        top: "var(--sr-nav-h)",
        zIndex: 50,
        background: "color-mix(in srgb, var(--sr-bg) 95%, transparent)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid var(--sr-border)",
        padding: "0 var(--sr-sp-6)",
        display: "flex",
        alignItems: "center",
        gap: "var(--sr-sp-1)",
        height: "var(--sr-subnav-h)",
        overflowX: "auto",
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`subtab ${activeTab === t.id ? "active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {hasLoaded && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", flexShrink: 0 }}>
            {macro?.snapshot_date && (
              <span className="sr-hint">
                Snapshot: {macro.snapshot_date}
              </span>
            )}
            <button
              onClick={loadData}
              disabled={loading}
              title="Refresh macro data"
              style={{
                padding: "4px 10px", fontSize: "var(--sr-t-xs)", fontWeight: 600,
                borderRadius: "var(--sr-radius-pill)", cursor: loading ? "default" : "pointer",
                background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)",
                color: loading ? "var(--sr-text-3)" : "var(--sr-text-2)",
              }}
            >
              {loading ? "…" : "↻ Refresh"}
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: "var(--sr-sp-6)", maxWidth: 1200, margin: "0 auto" }}>
        {error && (
          <div style={{
            padding: "var(--sr-sp-3) var(--sr-sp-4)",
            borderRadius: "var(--sr-radius)",
            background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)",
            color: "var(--sr-neg)",
            fontSize: "var(--sr-t-sm)",
            marginBottom: "var(--sr-sp-5)",
          }}>
            {error}
          </div>
        )}

        {!hasLoaded ? (
          /* ── Load gate ── */
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 480, textAlign: "center", gap: "var(--sr-sp-5)" }}>
            <div>
              <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "var(--sr-sp-2)" }}>
                Macro Dashboard
              </div>
              <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", maxWidth: 440, lineHeight: 1.7 }}>
                Composite scores, FRED indicators, market data and AI synthesis.
                Click below to fetch the latest snapshot from Supabase.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-1)", alignItems: "center" }}>
              {["Liquidity · Credit · Recession · Geopolitical · Housing composites", "43+ FRED series across 8 indicator categories", "Live ETF & crypto market quotes", "News sentiment scoring · AI OPLA synthesis"].map(line => (
                <div key={line} style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", display: "flex", alignItems: "center", gap: "var(--sr-sp-2)" }}>
                  <span style={{ color: "var(--sr-pos)", fontSize: 8 }}>▶</span>
                  {line}
                </div>
              ))}
            </div>
            <button
              className="btn-primary"
              onClick={loadData}
              disabled={loading}
              style={{ padding: "12px 36px", fontSize: "var(--sr-t-base)", fontWeight: 700, marginTop: "var(--sr-sp-2)" }}
            >
              {loading ? "Loading…" : "Load Macro Data"}
            </button>
            {loading && (
              <div className="sr-hint">
                Fetching macro_state from Supabase…
              </div>
            )}
          </div>
        ) : (
          /* ── Tab content — only mounts after manual load ── */
          <>
            {activeTab === "overview"   && <MacroOverview   macro={macro} loading={loading} />}
            {activeTab === "indicators" && <MacroIndicators macro={macro} loading={loading} />}
            {activeTab === "markets"    && <MacroMarkets    macro={macro} loading={loading} />}
            {activeTab === "monitors"   && <MacroMonitors   macro={macro} loading={loading} />}
            {activeTab === "analog"     && <MacroHistoricalAnalog macro={macro} loading={loading} />}
            {activeTab === "portfolio"  && <MacroPortfolio  macro={macro} loading={loading} />}
            {activeTab === "news"       && <MacroNews />}
            {activeTab === "ai"         && <MacroAI         macro={macro} loading={loading} />}
            {activeTab === "raw"        && <MacroRawData    macro={macro} loading={loading} />}
          </>
        )}
      </div>
    </div>
  );
}

function MacroRawData({ macro, loading }: { macro: MacroState | null; loading: boolean }) {
  const [q, setQ] = useState("");

  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} style={{ height: 28, borderRadius: 4, background: "var(--sr-surface-3)", animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
    </div>
  );

  if (!macro) return (
    <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)", padding: "var(--sr-sp-5)" }}>
      No data — load macro first.
    </div>
  );

  const entries = (Object.entries(macro) as [string, unknown][])
    .filter(([k, v]) => v != null && k !== "id")
    .filter(([k]) => q === "" || k.toLowerCase().includes(q.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  const nullEntries = (Object.entries(macro) as [string, unknown][])
    .filter(([k, v]) => v == null && k !== "id")
    .filter(([k]) => q === "" || k.toLowerCase().includes(q.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  const fmtVal = (v: unknown): string => {
    if (v == null) return "—";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string") return v;
    if (typeof v === "number") return v % 1 === 0 ? v.toString() : v.toFixed(4);
    return String(v);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-4)", marginBottom: "var(--sr-sp-4)", flexWrap: "wrap" }}>
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Filter field…"
          style={{
            flex: 1, maxWidth: 280,
            padding: "var(--sr-sp-2) var(--sr-sp-3)",
            background: "var(--sr-surface)", border: "1px solid var(--sr-border)",
            borderRadius: "var(--sr-radius)", color: "var(--sr-text)",
            fontSize: "var(--sr-t-sm)", outline: "none",
          }}
          onFocus={e => (e.target.style.borderColor = "var(--sr-amber)")}
          onBlur={e => (e.target.style.borderColor = "var(--sr-border)")}
        />
        <span className="sr-hint">
          {entries.length} populated · {nullEntries.length} null
        </span>
        {macro.updated_at && (
          <span className="sr-hint">
            Cron: {new Date(macro.updated_at as string).toLocaleString("es-MX")}
          </span>
        )}
      </div>

      <div style={{ background: "var(--sr-surface)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius-lg)", overflow: "hidden", marginBottom: "var(--sr-sp-4)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--sr-t-sm)" }}>
          <thead>
            <tr style={{ background: "var(--sr-surface-2)" }}>
              <th style={{ padding: "var(--sr-sp-2) var(--sr-sp-4)", textAlign: "left", color: "var(--sr-text-3)", fontWeight: 600, fontSize: "var(--sr-t-xs)", letterSpacing: "0.06em", textTransform: "uppercase", width: "50%" }}>Field</th>
              <th style={{ padding: "var(--sr-sp-2) var(--sr-sp-4)", textAlign: "right", color: "var(--sr-text-3)", fontWeight: 600, fontSize: "var(--sr-t-xs)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k} style={{ borderTop: "1px solid var(--sr-border)" }}>
                <td style={{ padding: "var(--sr-sp-2) var(--sr-sp-4)", color: "var(--sr-text-2)", fontSize: "11px" }} className="num">{k}</td>
                <td style={{
                  padding: "var(--sr-sp-2) var(--sr-sp-4)", textAlign: "right", fontWeight: 600, fontSize: "11px",
                  color: typeof v === "boolean" ? (v ? "var(--sr-pos)" : "var(--sr-neg)") : "var(--sr-text)",
                }} className="num">
                  {fmtVal(v)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nullEntries.length > 0 && (
        <details style={{ background: "var(--sr-surface)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius-lg)", overflow: "hidden" }}>
          <summary style={{ padding: "var(--sr-sp-3) var(--sr-sp-4)", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", cursor: "pointer" }}>
            {nullEntries.length} fields pending (null in macro_state)
          </summary>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--sr-t-sm)" }}>
            <tbody>
              {nullEntries.map(([k]) => (
                <tr key={k} style={{ borderTop: "1px solid var(--sr-border)" }}>
                  <td style={{ padding: "var(--sr-sp-2) var(--sr-sp-4)", color: "var(--sr-text-3)", fontSize: "11px", opacity: 0.5 }}>{k}</td>
                  <td style={{ padding: "var(--sr-sp-2) var(--sr-sp-4)", textAlign: "right", color: "var(--sr-text-3)", fontSize: "11px", opacity: 0.5 }}>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
