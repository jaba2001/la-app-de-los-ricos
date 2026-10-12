"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { datos } from "@/lib/dataClient";
import type { MacroState } from "@/lib/types";
import { stockPickingRegime } from "@/lib/microScore";
import { Sk } from "@/components/ui/Skeleton";
import DataError, { NO_SE_PUDO_CARGAR } from "@/components/ui/DataError";
import { ultimaTanda } from "@/lib/discovery";
import { t, tv } from "@/lib/i18n/cliente";
import Trans from "@/components/Trans";

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
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [feed, setFeed] = useState<Feed>("equity");
  const [group, setGroup] = useState<string>("All");

  useEffect(() => { if (!authLoading && !session) router.replace("/login"); }, [session, authLoading, router]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    setLoaded(false);
    setGroup("All");
    (async () => {
      const [{ data: d, error: eD }, { data: m, error: eM }] = await Promise.all([
        datos.from("sl_discovery").select("*").eq("feed", feed).order("rank", { ascending: true }),
        datos.from("macro_state").select("*").eq("id", 1).single(),
      ]);
      if (!alive) return;
      // Un fallo no es "no hay candidatos" (AUDIT_REPORT M-3).
      setErrorCarga(eD || eM ? NO_SE_PUDO_CARGAR : null);
      setRows(ultimaTanda((d as Row[]) ?? []));
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
      <DataError mensaje={errorCarga} />
      <div style={{ marginBottom: "var(--sr-sp-4)" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>{t("Discovery")}</h1>
        <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 6, maxWidth: 720, lineHeight: 1.6 }}>
          {isX ? (
            <><Trans text={"Metals, commodities, bonds, equity indices and sectors ranked by <s1>12-1m momentum</s1> — the same factor that drives the validated dual-momentum allocation. A cross-asset map of <s2>what is leading right now</s2>."} s1={(c) => <strong style={{ color: "var(--sr-text)" }}>{c}</strong>} s2={(c) => <em>{c}</em>} /></>
          ) : (
            <><Trans text={"The S&P 500 ranked by <s1>12-1m momentum</s1>. This is a map of <s2>what is leading right now</s2> — not a list of recommendations, and not a claim that these names will outperform."} s1={(c) => <strong style={{ color: "var(--sr-text)" }}>{c}</strong>} s2={(c) => <em>{c}</em>} /></>
          )}
        </p>
      </div>

      {/* Feed toggle */}
      <div style={{ display: "flex", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-4)" }}>
        <button className={`subtab ${!isX ? "active" : ""}`} onClick={() => setFeed("equity")}>{t("Stocks · S&P 500")}</button>
        <button className={`subtab ${isX ? "active" : ""}`} onClick={() => setFeed("cross-asset")}>{t("Cross-asset")}</button>
      </div>

      {/* Stock-picking regime gate — validated Phase 4 context */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-5)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${picking.color} 9%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${picking.color} 30%, transparent)` }}>
        <div style={{ minWidth: 58, textAlign: "center" }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("Corr")}</div>
          <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 800, color: picking.color, lineHeight: 1 }} className="num">{macro?.implied_corr != null ? macro.implied_corr.toFixed(0) : "—"}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: picking.color }}>{t(`Selection regime: ${picking.label}`)}</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, lineHeight: 1.45 }}>
            {isX ? t("Momentum leadership is most reliable in low-correlation regimes; when correlation is high, sleeves move together and the ranking carries less edge.") : t(picking.detail)}
          </div>
        </div>
      </div>

      {/* MEASURED HONESTY (F1, 2026-08-17). This ranking used to be presented as an
          opportunity list. It was audited over 192 months (2010-2026, 65,481 name-months,
          research/momentum_audit.mjs) and the top decile UNDERPERFORMED simply holding the
          index. Saying so is not a disclaimer — it is the product: no other platform tells
          you when its own ranking stops working. Full numbers in §7.10 of the plan. */}
      {!isX && (
        <div style={{ padding: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-5)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px dashed var(--sr-border)" }}>
          <div style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: "var(--sr-text-2)", marginBottom: 4 }}>
            {t("What we measured, before you trust this list")}</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", lineHeight: 1.5 }}>
            <Trans text={"Over <s1>192 months (2010–2026)</s1> on the point-in-time S&P 500, picking the top momentum decile returned <s2>+728%</s2> — while holding <s3>the same 400 names equally weighted</s3>, with no selection at all, returned <s4>+908%</s4>. Ranking by momentum<s5> lagged doing nothing by 180 points</s5>, and its information coefficient is statistically indistinguishable from zero. What the data <s6>does</s6> show is that the signal is strongly time-varying — its dispersion is 16× what chance would explain — which is why the regime below matters more than the ranking itself. Use this as a leadership map, not as a buy list."} s1={(c) => <strong style={{ color: "var(--sr-text-2)" }}>{c}</strong>} s2={(c) => <strong style={{ color: "var(--sr-neg)" }}>{c}</strong>} s3={(c) => <em>{c}</em>} s4={(c) => <strong style={{ color: "var(--sr-text-2)" }}>{c}</strong>} s5={(c) => <strong style={{ color: "var(--sr-neg)" }}>{c}</strong>} s6={(c) => <em>{c}</em>} /></div>
        </div>
      )}

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
          {t("The discovery feed is being built. The universe is scored weekly.")}</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="sr-table">
            <thead><tr>
              <th style={{ textAlign: "right" }}>#</th><th>{isX ? t("Instrument") : t("Ticker")}</th><th>{isX ? t("Class") : t("Sector")}</th>
              <th style={{ textAlign: "right" }}>{t("12-1m mom")}</th><th style={{ textAlign: "right" }}>6m</th>
              <th style={{ textAlign: "right" }}>{t("Momentum")}</th><th style={{ textAlign: "right" }}>{t("Price")}</th>
            </tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.ticker} style={{ cursor: "pointer" }} onClick={() => router.push(`/stock/${r.ticker}`)}>
                  <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{r.rank}</td>
                  <td style={{ fontWeight: 700, color: "var(--sr-text)" }}>
                    {r.ticker}
                    {isX && r.label && <span style={{ display: "block", fontSize: "10px", fontWeight: 500, color: "var(--sr-text-3)" }}>{tv(r.label)}</span>}
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
        {asOf ? t(`As of ${asOf} · `) : ""}{rows.length} {isX ? t("instruments") : t("names")} {" "}{t("· momentum from free EOD prices ·")}{" "}{isX ? t("research/discovery_instruments.mjs") : t("research/discovery.mjs")}
        {!isX && <> {" "}{t("· audited in")}{" "}<code style={{ fontSize: "inherit" }}>research/momentum_audit.mjs</code> {" "}{t("(192 months)")}</>}{t(". Educational — not investment advice.")}</div>
    </div>
  );
}
