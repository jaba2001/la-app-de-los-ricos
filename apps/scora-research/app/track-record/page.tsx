"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { GROWTH_BACKTEST as G, ALLOCATOR_BACKTEST as A, STOCK_PICKING as M } from "@/lib/trackRecord";
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

      {/* ── The headline: Growth vs the S&P 500, the only benchmark that matters ── */}
      <div className="section-label" style={{ color: "var(--sr-amber)" }}>Growth mandate vs the S&amp;P 500 · risk-adjusted scorecard · {G.period}</div>
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)", borderColor: "color-mix(in srgb, var(--sr-amber) 38%, var(--sr-border))" }}>
        <div className="sr-grid-4" style={{ marginBottom: "var(--sr-sp-3)" }}>
          <Stat label="Sharpe" value={G.strategy.sharpe.toFixed(2)} color="var(--sr-pos)" sub={`S&P ${G.spy.sharpe.toFixed(2)}`} />
          <Stat label="Sortino" value={G.strategy.sortino.toFixed(2)} color="var(--sr-pos)" sub={`S&P ${G.spy.sortino.toFixed(2)}`} />
          <Stat label="Calmar" value={G.strategy.calmar.toFixed(2)} color="var(--sr-pos)" sub={`S&P ${G.spy.calmar.toFixed(2)}`} />
          <Stat label="Max drawdown" value={pct(G.strategy.maxDrawdown, 0)} color="var(--sr-pos)" sub={`S&P ${pct(G.spy.maxDrawdown, 0)}`} />
        </div>
        <div className="sr-grid-4" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <Stat label="Jensen α / yr" value={`+${G.strategy.alpha}%`} color="var(--sr-pos)" sub="CAPM vs S&P" />
          <Stat label="Monthly VaR 95%" value={pct(G.strategy.var95, 1)} color="var(--sr-pos)" sub={`S&P ${pct(G.spy.var95, 1)}`} />
          <Stat label="Monthly CVaR 95%" value={pct(G.strategy.cvar95, 1)} color="var(--sr-pos)" sub={`S&P ${pct(G.spy.cvar95, 1)}`} />
          <Stat label="Total return" value={pct(G.strategy.totalReturn, 0)} color="var(--sr-text)" sub={`S&P ${pct(G.spy.totalReturn, 0)}`} />
        </div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.6 }}>
          The <strong>{G.strategy.label}</strong>, measured through the exact production path, {G.months} months net of costs. Over this window it <strong style={{ color: "var(--sr-pos)" }}>came out ahead on every risk-adjusted metric</strong> — Sharpe, Sortino, Calmar, Jensen alpha, and half the tail risk (VaR/CVaR) — at <strong>a third of the drawdown</strong>. <em>Came out ahead</em> is deliberate: the gap is real in this sample but does not reach statistical significance, and the panel below says by how much.
          It does <strong>not</strong> beat the index on raw total return (+{G.strategy.totalReturn.toFixed(0)}% vs +{G.spy.totalReturn.toFixed(0)}%), and we never pretend it does — <strong>no leverage, ever</strong>. Nothing unlevered beat the S&amp;P over this run. For context, beating it on raw return is rare even among professionals: <strong>~90% of active US large-cap funds trail the S&amp;P 500 over 15 years</strong> (SPIVA U.S. Scorecard, S&amp;P Dow Jones Indices) — but that measures total return, not the risk-adjusted edge shown above. A conservative <strong>Defensive</strong> profile (risk-parity, {pct(A.strategy.maxDrawdown, 0)} drawdown) is one click away. Includes a small BTC diversifier (CAIA/Grayscale ~5%), carved from equities — never leverage.
        </div>
      </div>

      {/* ── What these numbers do NOT say ──────────────────────────────────────────────
          This block is the product, not a disclaimer. The positioning is "radical honesty
          as a feature", and the three things below are exactly what a professional
          evaluator checks and what a retail app never shows. Every figure comes from
          lib/trackRecord.ts, which the golden test keeps in lock-step with the measurement. */}
      <div className="section-label" style={{ color: "var(--sr-text-2)" }}>What these numbers do <em>not</em> say</div>
      <div className="card" style={{ marginBottom: "var(--sr-sp-6)" }}>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.7 }}>
          <p style={{ marginTop: 0 }}>
            <strong>The Sharpe edge is not statistically significant.</strong> Over {G.months} months the
            difference against the S&amp;P 500 gives <strong>t&nbsp;=&nbsp;{G.significacion.tVsSpy}</strong> and
            against a static 60/40 <strong>t&nbsp;=&nbsp;{G.significacion.tVsBench6040}</strong> (Jobson-Korkie
            with Memmel&rsquo;s correction). Two decades of data are not enough to prove a Sharpe gap this
            size — reaching t&nbsp;=&nbsp;2 would take roughly <strong>17 more years</strong>. We publish the
            statistic instead of the adjective.
          </p>
          <p>
            <strong>The drawdown is a different kind of claim.</strong> {pct(G.strategy.maxDrawdown, 0)} against{" "}
            {pct(G.spy.maxDrawdown, 0)} is not an estimate that needs a confidence interval: it is the
            worst case that actually happened. The same goes for the capture ratios — the strategy took
            part in about two thirds of the index&rsquo;s up months and under half of its down months.
            Those are descriptions, and they are the ones we stand behind.
          </p>
          <p>
            <strong>But &ldquo;a third of the drawdown&rdquo; leans on 2008.</strong> Started from{" "}
            {G.robustezDrawdown.ventanasProbadas} different years, this strategy&rsquo;s worst loss barely
            moves — always between {G.robustezDrawdown.allocatorMax}% and {G.robustezDrawdown.allocatorMin}%,
            which is what risk control is supposed to look like. The index&rsquo;s does move: −50.7% with the
            financial crisis in the window, −23.9% without it. So the ratio is{" "}
            <strong>{G.robustezDrawdown.ratioRegistroCompleto}</strong> over the full record and{" "}
            <strong>{G.robustezDrawdown.ratioDesde2009}</strong> from 2009 onward. Both are true. Anyone
            who plots the series from 2010 will find the second one, so we put it here first.
          </p>
          <p>
            <strong>And the Sharpe does not survive deflation for the number of strategies we tried.</strong>{" "}
            Had we tested this once, the observed Sharpe would clear the bar comfortably (deflated
            probability {(G.deflacion.dsrConUnSoloEnsayo * 100).toFixed(1)}%). After{" "}
            {G.deflacion.ensayos} recorded trials on the same two decades of data, it drops to{" "}
            <strong>{(G.deflacion.dsr * 100).toFixed(1)}%</strong> — under the 95% convention. That is the
            price of having searched, and it is why every hypothesis from here on is written down
            before it is run.
          </p>
          <p>
            <strong>Returns are not normally distributed, and the Sharpe ratio assumes they are.</strong>{" "}
            Excess kurtosis is <strong>+{G.forma.curtosisExceso}</strong> — fatter tails, more extreme
            months, than the ratio&rsquo;s own maths presumes. Skew is near zero ({G.forma.asimetria}); the
            index&rsquo;s is negative ({G.forma.spyAsimetria}), which is the worse side to be on.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>Cash earns the T-bill rate here, not zero.</strong> Every ratio above uses the real
            risk-free rate ({G.tasaLibreRiesgo.fuente}, {G.tasaLibreRiesgo.mediaAnual}% average over the
            window). With the common shortcut of rf&nbsp;=&nbsp;0 the headline Sharpe would read{" "}
            <strong>{G.tasaLibreRiesgo.sharpeConRf0}</strong> instead of {G.strategy.sharpe.toFixed(2)}. The
            ranking between strategies is identical either way; the level is not, so we use the honest one.
          </p>
        </div>
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

      {/* ── Declaraciones formales ──
          La página ya era honesta en el fondo: dice "net of costs", marca el forward como
          UN-BACKTESTED y publica el resultado de stock-picking que NO funciona. Lo que
          faltaba era decirlo en los términos exactos que la industria exige, porque la
          distinción entre un resultado HIPOTÉTICO y uno REAL es precisamente la que se
          usa para engañar — y esta página existe para no hacerlo. */}
      <div className="card" style={{ marginTop: "var(--sr-sp-4)" }}>
        <div className="section-label">How to read these numbers</div>
        <dl style={{ margin: 0, fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.7 }}>
          <dt style={{ fontWeight: 700, color: "var(--sr-text)", marginTop: "var(--sr-sp-2)" }}>Hypothetical, not realized</dt>
          <dd style={{ margin: "2px 0 0 0" }}>
            The allocator and stock-picking results are <strong>hypothetical backtests</strong>: they were
            computed by applying rules to historical data, not by trading an account. Hypothetical results
            have inherent limitations — chief among them that they are prepared with the benefit of
            hindsight and carry no financial risk. No account traded these returns.
          </dd>

          <dt style={{ fontWeight: 700, color: "var(--sr-text)", marginTop: "var(--sr-sp-3)" }}>Net of what, exactly</dt>
          <dd style={{ margin: "2px 0 0 0" }}>
            Backtest returns are net of an assumed round-trip transaction cost applied at each rebalance.
            They are <strong>gross of</strong> taxes, bid-ask spread beyond that assumption, market impact,
            financing, and any subscription fee for this product. Your realized return would be lower.
          </dd>

          <dt style={{ fontWeight: 700, color: "var(--sr-text)", marginTop: "var(--sr-sp-3)" }}>Survivorship</dt>
          <dd style={{ margin: "2px 0 0 0" }}>
            The stock-picking test runs on a <strong>point-in-time, survivorship-free</strong> universe —
            it includes names that were later delisted or acquired. The allocator uses index ETFs, which
            carry the index provider&apos;s own reconstitution rules rather than ours.
          </dd>

          <dt style={{ fontWeight: 700, color: "var(--sr-text)", marginTop: "var(--sr-sp-3)" }}>Past performance</dt>
          <dd style={{ margin: "2px 0 0 0" }}>
            Past performance — hypothetical or realized — <strong>does not predict future results</strong>.
            A strategy that beat its benchmark over the sample above can underperform for years.
          </dd>

          <dt style={{ fontWeight: 700, color: "var(--sr-text)", marginTop: "var(--sr-sp-3)" }}>No testimonials, no selected trades</dt>
          <dd style={{ margin: "2px 0 0 0" }}>
            This page publishes the <strong>whole record</strong>, including the stock-picking result that
            lost to the index. Scora does not publish testimonials, screenshots of winning trades, or
            cherry-picked calls — a record you can only see the good half of is not a record.
          </dd>

          <dt style={{ fontWeight: 700, color: "var(--sr-text)", marginTop: "var(--sr-sp-3)" }}>Not investment advice</dt>
          <dd style={{ margin: "2px 0 0 0" }}>
            Scora Research is an educational tool. Nothing here is a recommendation to buy or sell any
            security, and it is not personalized to your circumstances.
          </dd>
        </dl>
      </div>

      <div style={{ textAlign: "right", fontSize: "10px", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-4)" }}>
        Allocator: research/backtest_assets.mjs (stationary regime) + walkforward.mjs · Stock-picking: research/backtest.mjs --full 500 · free data (EDGAR / Yahoo / Tiingo / FRED)
      </div>
    </div>
  );
}
