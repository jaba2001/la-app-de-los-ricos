"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
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
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("overview");
  const [macro, setMacro] = useState<MacroState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !session) router.replace("/login");
  }, [session, authLoading, router]);

  useEffect(() => {
    if (!session) return;
    supabase.from("macro_state").select("*").eq("id", 1).single().then(({ data, error }) => {
      if (error) setError(error.message);
      else setMacro(data as MacroState);
      setLoading(false);
    });
  }, [session]);

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
        {activeTab === "overview"   && <MacroOverview   macro={macro} loading={loading} />}
        {activeTab === "indicators" && <MacroIndicators macro={macro} loading={loading} />}
        {activeTab === "markets"    && <MacroMarkets    macro={macro} loading={loading} />}
        {activeTab === "monitors"   && <MacroMonitors   macro={macro} loading={loading} />}
        {activeTab === "news"       && <MacroNews />}
        {activeTab === "ai"         && <MacroAI         macro={macro} loading={loading} />}
      </div>
    </div>
  );
}
