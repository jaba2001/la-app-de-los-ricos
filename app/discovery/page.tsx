"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { MacroState } from "@/lib/types";
import { stockPickingRegime } from "@/lib/microScore";
import { Sk } from "@/components/ui/Skeleton";

interface Row {
  ticker: string; sector: string | null; price: number | null;
  mom_12_1: number | null; mom_6m: number | null; score: number | null; rank: number | null; updated_at: string | null;
  feed?: string | null; asset_class?: string | null; label?: string | null;
}

type Feed = "equity" | "cross-asset";

export default function DiscoveryPage() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [macro, setMacro] = useState<MacroState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [feed, setFeed] = useState<Feed>("equity");
  const [group, setGroup] = useState<string>("All");

  useEffect(() => { if (!authLoading && !session) router.replace("/login"); }, [session, authLoading, router]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    setLoaded(false);
    setGroup("All");
    (async () => {
      const [{ data: d }, { data: m }] = await Promise.all([
        supabase.from("sl_discovery").select("*").eq("feed", feed).order("rank", { ascending: true }),
        supabase.from("macro_state").select("*").eq("id", 1).single(),
      ]);
      if (!alive) return;
      setRows((d as Row[]) ?? []);
      setMacro((m as MacroState) ?? null);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [session, feed]);

  const isX = feed === "cross-asset";
  const picking = stockPickingRegime(macro?.implied_corr ?? null);
  const groups = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => r.sector).filter(Boolean) as string[])).sort()], [rows]);
  const filtered = useMemo(() => (group === "All" ? rows : rows.filter((r) => r.sector === group)), [rows, group]);
  const asOf = rows[0]?.updated_at ? new Date(rows[0].updated_at).toISOString().slice(0, 10) : null;

  if (authLoading || !session) return null;

  return (
    <div style={{ padding: "var(--sr-sp-6)", maxWidth: 1080, margin: "0 auto" }} className="animate-fade-in">
      <div style={{ marginBottom: "var(--sr-sp-4)" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Discovery</h1>
        <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 6, maxWidth: 720, lineHeight: 1.6 }}>
          {isX ? (
            <>Metals, commodities, bonds, equity indices and sectors ranked by <strong style={{ color: "var(--sr-text)" }}>12-1m momentum</strong> — the
            same factor that drives the validated dual-momentum allocation. A cross-asset map of <em>what is leading right now</em>.</>
          ) : (
            <>The S&amp;P 500 ranked by <strong style={{ color: "var(--sr-text)" }}>12-1m momentum</strong> — the factor that earns IC +0.07 (survivorship-free)
            <em> when market correlation is low</em>, and crashes when it&apos;s high. The regime below tells you whether to trust this list right now.</>
          )}
        </p>
      </div>

      {/* Feed toggle */}
      <div style={{ display: "flex", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-4)" }}>
        <button className={`subtab ${!isX ? "active" : ""}`} onClick={() => setFeed("equity")}>Stocks · S&amp;P 500</button>
        <button className={`subtab ${isX ? "active" : ""}`} onClick={() => setFeed("cross-asset")}>Cross-asset</button>
      </div>

      {/* Stock-picking regime gate — validated Phase 4 context */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-5)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${picking.color} 9%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${picking.color} 30%, transparent)` }}>
        <div style={{ minWidth: 58, textAlign: "center" }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Corr</div>
          <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 800, color: picking.color, lineHeight: 1 }} className="num">{macro?.implied_corr != null ? macro.implied_corr.toFixed(0) : "—"}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: picking.color }}>Selection regime: {picking.label}</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, lineHeight: 1.45 }}>
            {isX ? "Momentum leadership is most reliable in low-correlation regimes; when correlation is high, sleeves move together and the ranking carries less edge." : picking.detail}
          </div>
        </div>
      </div>

      {/* Group filter (sector for stocks · asset class for cross-asset) */}
      {loaded && (
        <div style={{ display: "flex", gap: "var(--sr-sp-2)", flexWrap: "wrap", marginBottom: "var(--sr-sp-4)" }}>
          {groups.map((s) => (
            <button key={s} className={`subtab ${group === s ? "active" : ""}`} onClick={() => setGroup(s)}>{s}</button>
          ))}
        </div>
      )}

      {!loaded ? (
        <Sk w="100%" h={360} />
      ) : rows.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>
          The discovery feed is being built. The universe is scored weekly.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="sr-table">
            <thead><tr>
              <th style={{ textAlign: "right" }}>#</th><th>{isX ? "Instrument" : "Ticker"}</th><th>{isX ? "Class" : "Sector"}</th>
              <th style={{ textAlign: "right" }}>12-1m mom</th><th style={{ textAlign: "right" }}>6m</th>
              <th style={{ textAlign: "right" }}>Momentum</th><th style={{ textAlign: "right" }}>Price</th>
            </tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.ticker} style={{ cursor: "pointer" }} onClick={() => router.push(`/stock/${r.ticker}`)}>
                  <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{r.rank}</td>
                  <td style={{ fontWeight: 700, color: "var(--sr-text)" }}>
                    {r.ticker}
                    {isX && r.label && <span style={{ display: "block", fontSize: "10px", fontWeight: 500, color: "var(--sr-text-3)" }}>{r.label}</span>}
                  </td>
                  <td style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-xs)" }}>{r.sector ?? "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: (r.mom_12_1 ?? 0) >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
                    {r.mom_12_1 != null ? (r.mom_12_1 > 0 ? "+" : "") + r.mom_12_1.toFixed(0) + "%" : "—"}
                  </td>
                  <td style={{ textAlign: "right", color: (r.mom_6m ?? 0) >= 0 ? "var(--sr-text-2)" : "var(--sr-neg)" }} className="num">
                    {r.mom_6m != null ? (r.mom_6m > 0 ? "+" : "") + r.mom_6m.toFixed(0) + "%" : "—"}
                  </td>
                  <td style={{ textAlign: "right" }} className="num">
                    <span style={{ display: "inline-block", minWidth: 34, padding: "1px 7px", borderRadius: "var(--sr-radius-pill)", fontWeight: 700, fontSize: "var(--sr-t-xs)", background: `color-mix(in srgb, ${((r.score ?? 0) >= 90 ? "var(--sr-pos)" : (r.score ?? 0) >= 70 ? "var(--sr-warn)" : "var(--sr-text-3)")} 14%, transparent)`, color: (r.score ?? 0) >= 90 ? "var(--sr-pos)" : (r.score ?? 0) >= 70 ? "var(--sr-warn)" : "var(--sr-text-3)" }}>
                      {r.score ?? "—"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{r.price != null ? `$${r.price.toFixed(0)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ textAlign: "right", fontSize: "10px", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-4)" }}>
        {asOf ? `As of ${asOf} · ` : ""}{rows.length} {isX ? "instruments" : "names"} · momentum from free EOD prices · {isX ? "research/discovery_instruments.mjs" : "research/discovery.mjs"}. Educational — not investment advice.
      </div>
    </div>
  );
}
