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

const TABS = [
  { id: "overview",    label: "Overview" },
  { id: "indicators",  label: "Indicators" },
  { id: "markets",     label: "Markets" },
  { id: "monitors",    label: "Monitors" },
  { id: "news",        label: "News" },
  { id: "ai",          label: "AI Synthesis" },
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
    if (err) setError(err.message);
    else {
      setMacro(data as MacroState);
      setMacroContext(data as MacroState);
    }
    setHasLoaded(true);
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
              <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
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
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
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
            {activeTab === "news"       && <MacroNews />}
            {activeTab === "ai"         && <MacroAI         macro={macro} loading={loading} />}
          </>
        )}
      </div>
    </div>
  );
}
