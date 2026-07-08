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
}

export default function DiscoveryPage() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [macro, setMacro] = useState<MacroState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sector, setSector] = useState<string>("All");

  useEffect(() => { if (!authLoading && !session) router.replace("/login"); }, [session, authLoading, router]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const [{ data: d }, { data: m }] = await Promise.all([
        supabase.from("sl_discovery").select("*").order("rank", { ascending: true }),
        supabase.from("macro_state").select("*").eq("id", 1).single(),
      ]);
      setRows((d as Row[]) ?? []);
      setMacro((m as MacroState) ?? null);
      setLoaded(true);
    })();
  }, [session]);

  const picking = stockPickingRegime(macro?.implied_corr ?? null);
  const sectors = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => r.sector).filter(Boolean) as string[])).sort()], [rows]);
  const filtered = useMemo(() => (sector === "All" ? rows : rows.filter((r) => r.sector === sector)), [rows, sector]);
  const asOf = rows[0]?.updated_at ? new Date(rows[0].updated_at).toISOString().slice(0, 10) : null;

  if (authLoading || !session) return null;

  return (
    <div style={{ padding: "var(--sr-sp-6)", maxWidth: 1080, margin: "0 auto" }} className="animate-fade-in">
      <div style={{ marginBottom: "var(--sr-sp-5)" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Discovery</h1>
        <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 6, maxWidth: 720, lineHeight: 1.6 }}>
          The S&amp;P 500 ranked by <strong style={{ color: "var(--sr-text)" }}>12-1m momentum</strong> — the factor that earns IC +0.07 (survivorship-free)
          <em> when market correlation is low</em>, and crashes when it&apos;s high. The regime below tells you whether to trust this list right now.
        </p>
      </div>

      {/* Stock-picking regime gate — validated Phase 4 context */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-5)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${picking.color} 9%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${picking.color} 30%, transparent)` }}>
        <div style={{ minWidth: 58, textAlign: "center" }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Corr</div>
          <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 800, color: picking.color, lineHeight: 1 }} className="num">{macro?.implied_corr != null ? macro.implied_corr.toFixed(0) : "—"}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: picking.color }}>Selection regime: {picking.label}</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, lineHeight: 1.45 }}>{picking.detail}</div>
        </div>
      </div>

      {/* Sector filter */}
      {loaded && (
        <div style={{ display: "flex", gap: "var(--sr-sp-2)", flexWrap: "wrap", marginBottom: "var(--sr-sp-4)" }}>
          {sectors.map((s) => (
            <button key={s} className={`subtab ${sector === s ? "active" : ""}`} onClick={() => setSector(s)}>{s}</button>
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
              <th style={{ textAlign: "right" }}>#</th><th>Ticker</th><th>Sector</th>
              <th style={{ textAlign: "right" }}>12-1m mom</th><th style={{ textAlign: "right" }}>6m</th>
              <th style={{ textAlign: "right" }}>Momentum</th><th style={{ textAlign: "right" }}>Price</th>
            </tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.ticker} style={{ cursor: "pointer" }} onClick={() => router.push(`/stock/${r.ticker}`)}>
                  <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{r.rank}</td>
                  <td style={{ fontWeight: 700, color: "var(--sr-text)" }}>{r.ticker}</td>
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
        {asOf ? `As of ${asOf} · ` : ""}{rows.length} names · momentum from free EOD prices · research/discovery.mjs. Educational — not investment advice.
      </div>
    </div>
  );
}
