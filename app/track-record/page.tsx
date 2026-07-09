"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { ALLOCATOR_BACKTEST as A, STOCK_PICKING as M } from "@/lib/trackRecord";
import PaperFund from "@/components/macro/PaperFund";

interface LiveSummary {
  as_of: string | null; months_live: number | null; cohorts: number | null; names_scored: number | null;
  buy_hit_rate: number | null; buy_total_return: number | null; spy_total_return: number | null;
  information_coefficient: number | null; updated_at: string | null;
}

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const clr = (v: number | null | undefined) => (v == null ? "var(--sr-text-3)" : v >= 0 ? "var(--sr-pos)" : "var(--sr-neg)");

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="sr-tile">
      <div className="sr-tile-label">{label}</div>
      <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, color: color ?? "var(--sr-text)" }} className="num">{value}</div>
      {sub && <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function TrackRecordPage() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [live, setLive] = useState<LiveSummary | null>(null);
  const [cohortRows, setCohortRows] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { if (!authLoading && !session) router.replace("/login"); }, [session, authLoading, router]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase.from("sl_track_summary").select("*").eq("id", 1).maybeSingle();
      setLive((data as LiveSummary) ?? null);
      const { count } = await supabase.from("sl_cohort").select("id", { count: "exact", head: true });
      setCohortRows(count ?? 0);
      setLoaded(true);
    })();
  }, [session]);

  if (authLoading || !session) return null;

  return (
    <div style={{ padding: "var(--sr-sp-6)", maxWidth: 1080, margin: "0 auto" }} className="animate-fade-in">
      <div style={{ marginBottom: "var(--sr-sp-6)" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Track Record</h1>
        <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 6, maxWidth: 720, lineHeight: 1.6 }}>
          The evidence, measured — not asserted. The honest finding: <strong style={{ color: "var(--sr-text)" }}>picking stocks doesn&apos;t
          beat the market, but regime-driven multi-asset allocation does</strong> — risk-adjusted, with a fifth of the drawdown. Below:
          the validated allocator backtest (out-of-sample), the honest stock-picking result, and a live forward record. Transparency is the point.
        </p>
      </div>

      {/* ── Autonomous paper fund (the living, self-running proof) ── */}
      <PaperFund />

      {/* ── Live forward record ── */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-6)", borderColor: "color-mix(in srgb, var(--sr-amber) 30%, var(--sr-border))" }}>
        <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)" }}>
          <div className="section-label" style={{ margin: 0 }}>Live forward record</div>
          <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: "var(--sr-radius-pill)", background: "color-mix(in srgb, var(--sr-pos) 14%, transparent)", color: "var(--sr-pos)" }}>UN-BACKTESTED</span>
        </div>
        {!loaded ? (
          <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)", padding: "var(--sr-sp-3) 0" }}>Loading…</div>
        ) : live && (live.months_live ?? 0) > 0 ? (
          <div className="sr-grid-4">
            <Stat label="Cohorts sealed" value={String(live.cohorts ?? 0)} sub="since inception" />
            <Stat label="BUY hit-rate" value={live.buy_hit_rate != null ? `${(live.buy_hit_rate * 100).toFixed(0)}%` : "—"} sub="beating SPY" />
            <Stat label="BUY avg return" value={pct(live.buy_total_return)} color={clr(live.buy_total_return)} sub={`SPY ${pct(live.spy_total_return)}`} />
            <Stat label="Live IC" value={live.information_coefficient != null ? live.information_coefficient.toFixed(3) : "—"} sub="score ↔ realized" />
          </div>
        ) : (
          <div style={{ color: "var(--sr-text-2)", fontSize: "var(--sr-t-sm)", lineHeight: 1.6 }}>
            <strong style={{ color: "var(--sr-text)" }}>Accumulating.</strong> {cohortRows ? `${cohortRows} scores sealed so far. ` : "The first cohort seals on the next monthly run. "}
            The systematic cron scores the universe on the 2nd of each month and seals an immutable cohort; realized alpha vs SPY is
            measured weekly. In 3–6 months this becomes a clean forward record no one can accuse of overfitting.
          </div>
        )}
      </div>

      {/* ── The validated edge — multi-asset allocator ── */}
      <div className="section-label" style={{ color: "var(--sr-amber)" }}>The validated edge · regime-driven multi-asset allocation · {A.period}</div>
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)", borderColor: "color-mix(in srgb, var(--sr-amber) 38%, var(--sr-border))" }}>
        <div className="sr-grid-5" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <Stat label="Allocator Sharpe" value={A.strategy.sharpe.toFixed(2)} color="var(--sr-pos)" sub={`SPY ${A.spy.sharpe.toFixed(2)}`} />
          <Stat label="Max drawdown" value={pct(A.strategy.maxDrawdown, 0)} color="var(--sr-pos)" sub={`SPY ${pct(A.spy.maxDrawdown, 0)}`} />
          <Stat label="Walk-forward OOS" value={A.walkForward.oosSharpe.toFixed(2)} color="var(--sr-pos)" sub={`Sharpe · gap ~${A.walkForward.overfitGap.toFixed(2)}`} />
          <Stat label="Total return" value={pct(A.strategy.totalReturn, 0)} sub={`SPY ${pct(A.spy.totalReturn, 0)}`} />
          <Stat label="Window" value={`${A.months}m`} sub="incl. the GFC" />
        </div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.6 }}>
          A liquidity-led risk-on tilt across six liquid ETFs plus a dual-momentum trend gate — the <strong>{A.strategy.label}</strong>. It matches
          equity-like results with roughly <strong>a fifth of the drawdown</strong> and a far higher Sharpe (1.01 vs 0.71). Crucially it beats a
          regime-free dual-momentum control (Sharpe {A.control.sharpe.toFixed(2)}) <strong>out-of-sample</strong>: the walk-forward OOS Sharpe is
          {" "}{A.walkForward.oosSharpe.toFixed(2)} over {A.walkForward.oosMonths} months ({A.walkForward.period}) with a near-zero overfit gap.
        </div>

        {/* sub-period Sharpe — strategy vs control vs SPY */}
        <div style={{ overflowX: "auto", marginTop: "var(--sr-sp-4)" }}>
          <table className="sr-table" style={{ minWidth: 460 }}>
            <thead><tr><th>Sharpe by sub-period</th><th style={{ textAlign: "right" }}>Allocator</th><th style={{ textAlign: "right" }}>Dual-mom only</th><th style={{ textAlign: "right" }}>SPY</th></tr></thead>
            <tbody>
              {A.subPeriods.map((s) => (
                <tr key={s.label}>
                  <td style={{ fontWeight: 600 }}>{s.label}</td>
                  <td style={{ textAlign: "right", color: "var(--sr-pos)", fontWeight: 700 }} className="num">{s.strat.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }} className="num">{s.control.toFixed(2)}</td>
                  <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{s.spy.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Stock-picking, honestly ── */}
      <div className="section-label">Stock-picking, honestly · {M.universe} names · survivorship-free</div>
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="sr-grid-3" style={{ marginBottom: "var(--sr-sp-3)" }}>
          <Stat label="Value/quality return" value={pct(M.valueQuality.totalReturn, 0)} color="var(--sr-neg)" sub={`SPY ${pct(M.valueQuality.spyReturn, 0)}`} />
          <Stat label="Info. Coefficient" value={M.valueQuality.ic.toFixed(3)} sub={`${M.nameMonths.toLocaleString()} name-months`} />
          <Stat label="Momentum IC · low corr" value={`+${M.momentumIC.low.toFixed(3)}`} color="var(--sr-pos)" sub={`high corr ${M.momentumIC.high.toFixed(3)}`} />
        </div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.6 }}>
          On the full {M.universe}-name survivorship-free universe, ranking by <strong>value/quality does not beat SPY</strong> ({pct(M.valueQuality.totalReturn, 0)} vs
          {" "}{pct(M.valueQuality.spyReturn, 0)}, IC {M.valueQuality.ic.toFixed(3)}). But selection isn&apos;t dead — it&apos;s <strong>conditional</strong>: a
          momentum score earns <strong style={{ color: "var(--sr-pos)" }}>+{M.momentumIC.low.toFixed(3)} IC</strong> (top-minus-bottom decile +{M.momentumDecileLow}% at 3M)
          when market correlation is <strong>low</strong> — a stock-picker&apos;s tape — and <strong style={{ color: "var(--sr-neg)" }}>{M.momentumIC.high.toFixed(3)}</strong>
          {" "}when correlation is high (momentum crashes). That is the &ldquo;stock-picking regime&rdquo; switch surfaced in the app.
        </div>
      </div>

      {/* ── Caveats ── */}
      <div className="card" style={{ borderColor: "color-mix(in srgb, var(--sr-warn) 25%, var(--sr-border))" }}>
        <div className="section-label" style={{ color: "var(--sr-warn)" }}>Caveats — read these</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.7 }}>
          {A.notes.map((c, i) => <li key={i} style={{ marginBottom: 6 }}>{c}</li>)}
          <li style={{ marginBottom: 6 }}>Backtest thresholds and basket weights are literature priors, not return-fit; the live forward record above is the un-backtested proof.</li>
        </ul>
      </div>

      <div style={{ textAlign: "right", fontSize: "10px", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-4)" }}>
        Allocator: research/backtest_assets.mjs (stationary regime) + walkforward.mjs · Stock-picking: research/backtest.mjs --full 500 · free data (EDGAR / Yahoo / Tiingo / FRED)
      </div>
    </div>
  );
}
