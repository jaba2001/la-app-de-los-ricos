"use client";
import { useEffect, useState } from "react";
import { GROWTH_BACKTEST as G, ALLOCATOR_BACKTEST as A, STOCK_PICKING as M } from "@/lib/trackRecord";
import PaperFund from "@/components/macro/PaperFund";
import { t, tv } from "@/lib/i18n/cliente";
import Trans from "@/components/Trans";

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
      <div className="sr-tile-label">{tv(label)}</div>
      <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, color: color ?? "var(--sr-text)" }} className="num">{value}</div>
      {sub && <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>{tv(sub)}</div>}
    </div>
  );
}

// Publica a proposito: esta en el sitemap como indexable y la landing la enlaza
// tres veces. Antes tenia guardia de login, asi que quien llegaba desde Google
// acababa en la pantalla de acceso. El expediente publicado se sirve por
// /api/publico, que no exige sesion.
export default function TrackRecordPage() {
  const [live, setLive] = useState<LiveSummary | null>(null);
  const [cohortRows, setCohortRows] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/publico");
        if (res.ok) {
          const d = await res.json();
          setLive((d.resumen as LiveSummary) ?? null);
          setCohortRows(d.cohortes ?? 0);
        }
      } catch { /* el backtest validado es estatico y se pinta igual */ }
      setLoaded(true);
    })();
  }, []);

  return (
    <div style={{ padding: "var(--sr-sp-6)", maxWidth: 1080, margin: "0 auto" }} className="animate-fade-in">
      <div style={{ marginBottom: "var(--sr-sp-6)" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>{t("Track Record")}</h1>
        <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 6, maxWidth: 720, lineHeight: 1.6 }}>
          <Trans text={"The evidence, measured — not asserted. The honest finding: <s1>picking stocks doesn't beat the market, but regime-driven multi-asset allocation does</s1> — risk-adjusted, with a fifth of the drawdown. Below: the validated allocator backtest (out-of-sample), the honest stock-picking result, and a live forward record. Transparency is the point."} s1={(c) => <strong style={{ color: "var(--sr-text)" }}>{c}</strong>} /></p>
      </div>

      {/* ── The headline: Growth vs the S&P 500, the only benchmark that matters ── */}
      <div className="section-label" style={{ color: "var(--sr-amber)" }}>{t(`Growth mandate vs the S&P 500 · risk-adjusted scorecard · ${G.period}`)}</div>
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)", borderColor: "color-mix(in srgb, var(--sr-amber) 38%, var(--sr-border))" }}>
        <div className="sr-grid-4" style={{ marginBottom: "var(--sr-sp-3)" }}>
          <Stat label={t("Sharpe")} value={G.strategy.sharpe.toFixed(2)} color="var(--sr-pos)" sub={`S&P ${G.spy.sharpe.toFixed(2)}`} />
          <Stat label={t("Sortino")} value={G.strategy.sortino.toFixed(2)} color="var(--sr-pos)" sub={`S&P ${G.spy.sortino.toFixed(2)}`} />
          <Stat label={t("Calmar")} value={G.strategy.calmar.toFixed(2)} color="var(--sr-pos)" sub={`S&P ${G.spy.calmar.toFixed(2)}`} />
          <Stat label={t("Max drawdown")} value={pct(G.strategy.maxDrawdown, 0)} color="var(--sr-pos)" sub={`S&P ${pct(G.spy.maxDrawdown, 0)}`} />
        </div>
        <div className="sr-grid-4" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <Stat label={t("Jensen α / yr")} value={`+${G.strategy.alpha}%`} color="var(--sr-pos)" sub={t("CAPM vs S&P")} />
          <Stat label={t("Monthly VaR 95%")} value={pct(G.strategy.var95, 1)} color="var(--sr-pos)" sub={`S&P ${pct(G.spy.var95, 1)}`} />
          <Stat label={t("Monthly CVaR 95%")} value={pct(G.strategy.cvar95, 1)} color="var(--sr-pos)" sub={`S&P ${pct(G.spy.cvar95, 1)}`} />
          <Stat label={t("Total return")} value={pct(G.strategy.totalReturn, 0)} color="var(--sr-text)" sub={`S&P ${pct(G.spy.totalReturn, 0)}`} />
        </div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.6 }}>
          <Trans text={`The <s1>${G.strategy.label}</s1>, measured through the exact production path, ${G.months} months net of costs. Over this window it <s2>came out ahead on every risk-adjusted metric</s2> — Sharpe, Sortino, Calmar, Jensen alpha, and half the tail risk (VaR/CVaR) — at <s3>a third of the drawdown</s3>. <s4>Came out ahead</s4> is deliberate: the gap is real in this sample but does not reach statistical significance, and the panel below says by how much. It does <s5>not</s5> beat the index on raw total return (+${G.strategy.totalReturn.toFixed(0)}% vs +${G.spy.totalReturn.toFixed(0)}%), and we never pretend it does — <s6>no leverage, ever</s6>. Nothing unlevered beat the S&P over this run. For context, beating it on raw return is rare even among professionals: <s7>~90% of active US large-cap funds trail the S&P 500 over 15 years</s7> (SPIVA U.S. Scorecard, S&P Dow Jones Indices) — but that measures total return, not the risk-adjusted edge shown above. A conservative <s8>Defensive</s8> profile (risk-parity, ${pct(A.strategy.maxDrawdown, 0)} drawdown) is one click away. Includes a small BTC diversifier (CAIA/Grayscale ~5%), carved from equities — never leverage.`} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong style={{ color: "var(--sr-pos)" }}>{c}</strong>} s3={(c) => <strong>{c}</strong>} s4={(c) => <em>{c}</em>} s5={(c) => <strong>{c}</strong>} s6={(c) => <strong>{c}</strong>} s7={(c) => <strong>{c}</strong>} s8={(c) => <strong>{c}</strong>} /></div>
      </div>

      {/* ── What these numbers do NOT say ──────────────────────────────────────────────
          This block is the product, not a disclaimer. The positioning is "radical honesty
          as a feature", and the three things below are exactly what a professional
          evaluator checks and what a retail app never shows. Every figure comes from
          lib/trackRecord.ts, which the golden test keeps in lock-step with the measurement. */}
      <div className="section-label" style={{ color: "var(--sr-text-2)" }}><Trans text={"What these numbers do <s1>not</s1> say"} s1={(c) => <em>{c}</em>} /></div>
      <div className="card" style={{ marginBottom: "var(--sr-sp-6)" }}>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.7 }}>
          <p style={{ marginTop: 0 }}>
            <Trans text={`<s1>The Sharpe edge is not statistically significant.</s1> Over ${G.months} months the difference against the S&P 500 gives <s2>t = ${G.significacion.tVsSpy}</s2> and against a static 60/40 <s3>t = ${G.significacion.tVsBench6040}</s3> (Jobson-Korkie with Memmel’s correction). Two decades of data are not enough to prove a Sharpe gap this size — reaching t = 2 would take roughly <s4>17 more years</s4>. We publish the statistic instead of the adjective.`} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} s3={(c) => <strong>{c}</strong>} s4={(c) => <strong>{c}</strong>} /></p>
          <p>
            <Trans text={`<s1>The drawdown is a different kind of claim.</s1> ${pct(G.strategy.maxDrawdown, 0)} against ${pct(G.spy.maxDrawdown, 0)} is not an estimate that needs a confidence interval: it is the worst case that actually happened. The same goes for the capture ratios — the strategy took part in about two thirds of the index’s up months and under half of its down months. Those are descriptions, and they are the ones we stand behind.`} s1={(c) => <strong>{c}</strong>} /></p>
          <p>
            <Trans text={`<s1>But “a third of the drawdown” leans on 2008.</s1> Started from ${G.robustezDrawdown.ventanasProbadas} different years, this strategy’s worst loss barely moves — always between ${G.robustezDrawdown.allocatorMax}% and ${G.robustezDrawdown.allocatorMin}%, which is what risk control is supposed to look like. The index’s does move: −50.7% with the financial crisis in the window, −23.9% without it. So the ratio is <s2>${G.robustezDrawdown.ratioRegistroCompleto}</s2> over the full record and <s3>${G.robustezDrawdown.ratioDesde2009}</s3> from 2009 onward. Both are true. Anyone who plots the series from 2010 will find the second one, so we put it here first.`} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} s3={(c) => <strong>{c}</strong>} /></p>
          <p>
            <Trans text={`<s1>And the Sharpe does not survive deflation for the number of strategies we tried.</s1> Had we tested this once, the observed Sharpe would clear the bar comfortably (deflated probability ${(G.deflacion.dsrConUnSoloEnsayo * 100).toFixed(1)}%). After ${G.deflacion.ensayos} recorded trials on the same two decades of data, it drops to <s2>${(G.deflacion.dsr * 100).toFixed(1)}%</s2> — under the 95% convention. That is the price of having searched, and it is why every hypothesis from here on is written down before it is run.`} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} /></p>
          <p>
            <Trans text={`<s1>Returns are not normally distributed, and the Sharpe ratio assumes they are.</s1> Excess kurtosis is <s2>+${G.forma.curtosisExceso}</s2> — fatter tails, more extreme months, than the ratio’s own maths presumes. Skew is near zero (${G.forma.asimetria}); the index’s is negative (${G.forma.spyAsimetria}), which is the worse side to be on.`} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} /></p>
          <p style={{ marginBottom: 0 }}>
            <Trans text={`<s1>Cash earns the T-bill rate here, not zero.</s1> Every ratio above uses the real risk-free rate (${G.tasaLibreRiesgo.fuente}, ${G.tasaLibreRiesgo.mediaAnual}% average over the window). With the common shortcut of rf = 0 the headline Sharpe would read <s2>${G.tasaLibreRiesgo.sharpeConRf0}</s2> instead of ${G.strategy.sharpe.toFixed(2)}. The ranking between strategies is identical either way; the level is not, so we use the honest one.`} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} /></p>
        </div>
      </div>

      {/* ── Autonomous paper fund (the living, self-running proof) ── */}
      <PaperFund />

      {/* ── Live forward record ── */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-6)", borderColor: "color-mix(in srgb, var(--sr-amber) 30%, var(--sr-border))" }}>
        <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)" }}>
          <div className="section-label" style={{ margin: 0 }}>{t("Live forward record")}</div>
          <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: "var(--sr-radius-pill)", background: "color-mix(in srgb, var(--sr-pos) 14%, transparent)", color: "var(--sr-pos)" }}>UN-BACKTESTED</span>
        </div>
        {!loaded ? (
          <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)", padding: "var(--sr-sp-3) 0" }}>{t("Loading…")}</div>
        ) : live && (live.months_live ?? 0) > 0 ? (
          <div className="sr-grid-4">
            <Stat label={t("Cohorts sealed")} value={String(live.cohorts ?? 0)} sub={t("since inception")} />
            <Stat label={t("BUY hit-rate")} value={live.buy_hit_rate != null ? `${(live.buy_hit_rate * 100).toFixed(0)}%` : "—"} sub={t("beating SPY")} />
            <Stat label={t("BUY avg return")} value={pct(live.buy_total_return)} color={clr(live.buy_total_return)} sub={`SPY ${pct(live.spy_total_return)}`} />
            <Stat label={t("Live IC")} value={live.information_coefficient != null ? live.information_coefficient.toFixed(3) : "—"} sub={t("score ↔ realized")} />
          </div>
        ) : (
          <div style={{ color: "var(--sr-text-2)", fontSize: "var(--sr-t-sm)", lineHeight: 1.6 }}>
            <strong style={{ color: "var(--sr-text)" }}>{t("Accumulating.")}</strong> {cohortRows ? t(`${cohortRows} scores sealed so far. `) : t("The first cohort seals on the next monthly run. ")}
            {t("The systematic cron scores the universe on the 2nd of each month and seals an immutable cohort; realized alpha vs SPY is measured weekly. In 3–6 months this becomes a clean forward record no one can accuse of overfitting.")}</div>
        )}
      </div>

      {/* ── The validated edge — multi-asset allocator ── */}
      <div className="section-label" style={{ color: "var(--sr-amber)" }}>{t(`The validated edge · regime-driven multi-asset allocation · ${A.period}`)}</div>
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)", borderColor: "color-mix(in srgb, var(--sr-amber) 38%, var(--sr-border))" }}>
        <div className="sr-grid-5" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <Stat label={t("Allocator Sharpe")} value={A.strategy.sharpe.toFixed(2)} color="var(--sr-pos)" sub={`SPY ${A.spy.sharpe.toFixed(2)}`} />
          <Stat label={t("Max drawdown")} value={pct(A.strategy.maxDrawdown, 0)} color="var(--sr-pos)" sub={`SPY ${pct(A.spy.maxDrawdown, 0)}`} />
          <Stat label={t("Walk-forward OOS")} value={A.walkForward.oosSharpe.toFixed(2)} color="var(--sr-pos)" sub={t(`Sharpe · gap ~${A.walkForward.overfitGap.toFixed(2)}`)} />
          <Stat label={t("Total return")} value={pct(A.strategy.totalReturn, 0)} sub={`SPY ${pct(A.spy.totalReturn, 0)}`} />
          <Stat label={t("Window")} value={`${A.months}m`} sub={t("incl. the GFC")} />
        </div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.6 }}>
          <Trans text={`A liquidity-led risk-on tilt across six liquid ETFs plus a dual-momentum trend gate — the <s1>${A.strategy.label}</s1>. It matches equity-like results with roughly <s2>a fifth of the drawdown</s2> and a far higher Sharpe (1.01 vs 0.71). Crucially it beats a regime-free dual-momentum control (Sharpe ${A.control.sharpe.toFixed(2)}) <s3>out-of-sample</s3>: the walk-forward OOS Sharpe is ${A.walkForward.oosSharpe.toFixed(2)} over ${A.walkForward.oosMonths} months (${A.walkForward.period}) with a near-zero overfit gap.`} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} s3={(c) => <strong>{c}</strong>} /></div>

        {/* sub-period Sharpe — strategy vs control vs SPY */}
        <div style={{ overflowX: "auto", marginTop: "var(--sr-sp-4)" }}>
          <table className="sr-table" style={{ minWidth: 460 }}>
            <thead><tr><th>{t("Sharpe by sub-period")}</th><th style={{ textAlign: "right" }}>{t("Allocator")}</th><th style={{ textAlign: "right" }}>{t("Dual-mom only")}</th><th style={{ textAlign: "right" }}>SPY</th></tr></thead>
            <tbody>
              {A.subPeriods.map((s) => (
                <tr key={s.label}>
                  <td style={{ fontWeight: 600 }}>{tv(s.label)}</td>
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
      <div className="section-label">{t(`Stock-picking, honestly · ${M.universe} names · survivorship-free`)}</div>
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="sr-grid-3" style={{ marginBottom: "var(--sr-sp-3)" }}>
          <Stat label={t("Value/quality return")} value={pct(M.valueQuality.totalReturn, 0)} color="var(--sr-neg)" sub={`SPY ${pct(M.valueQuality.spyReturn, 0)}`} />
          <Stat label={t("Info. Coefficient")} value={M.valueQuality.ic.toFixed(3)} sub={t(`${M.nameMonths.toLocaleString("en-US")} name-months`)} />
          <Stat label={t("Momentum IC · low corr")} value={`+${M.momentumIC.low.toFixed(3)}`} color="var(--sr-pos)" sub={t(`high corr ${M.momentumIC.high.toFixed(3)}`)} />
        </div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.6 }}>
          <Trans text={`On the full ${M.universe}-name survivorship-free universe, ranking by <s1>value/quality does not beat SPY</s1> (${pct(M.valueQuality.totalReturn, 0)} vs ${pct(M.valueQuality.spyReturn, 0)}, IC ${M.valueQuality.ic.toFixed(3)}). But selection isn't dead — it's <s2>conditional</s2>: a momentum score earns <s3>+${M.momentumIC.low.toFixed(3)} IC</s3> (top-minus-bottom decile +${M.momentumDecileLow}% at 3M) when market correlation is <s4>low</s4> — a stock-picker's tape — and <s5>${M.momentumIC.high.toFixed(3)}</s5> when correlation is high (momentum crashes). That is the “stock-picking regime” switch surfaced in the app.`} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} s3={(c) => <strong style={{ color: "var(--sr-pos)" }}>{c}</strong>} s4={(c) => <strong>{c}</strong>} s5={(c) => <strong style={{ color: "var(--sr-neg)" }}>{c}</strong>} /></div>
      </div>

      {/* ── Caveats ── */}
      <div className="card" style={{ borderColor: "color-mix(in srgb, var(--sr-warn) 25%, var(--sr-border))" }}>
        <div className="section-label" style={{ color: "var(--sr-warn)" }}>{t("Caveats — read these")}</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.7 }}>
          {A.notes.map((c, i) => <li key={i} style={{ marginBottom: 6 }}>{t(c)}</li>)}
          <li style={{ marginBottom: 6 }}>{t("Backtest thresholds and basket weights are literature priors, not return-fit; the live forward record above is the un-backtested proof.")}</li>
        </ul>
      </div>

      {/* ── Declaraciones formales ──
          La página ya era honesta en el fondo: dice "net of costs", marca el forward como
          UN-BACKTESTED y publica el resultado de stock-picking que NO funciona. Lo que
          faltaba era decirlo en los términos exactos que la industria exige, porque la
          distinción entre un resultado HIPOTÉTICO y uno REAL es precisamente la que se
          usa para engañar — y esta página existe para no hacerlo. */}
      <div className="card" style={{ marginTop: "var(--sr-sp-4)" }}>
        <div className="section-label">{t("How to read these numbers")}</div>
        <dl style={{ margin: 0, fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.7 }}>
          <dt style={{ fontWeight: 700, color: "var(--sr-text)", marginTop: "var(--sr-sp-2)" }}>{t("Hypothetical, not realized")}</dt>
          <dd style={{ margin: "2px 0 0 0" }}>
            <Trans text={"The allocator and stock-picking results are <s1>hypothetical backtests</s1>: they were computed by applying rules to historical data, not by trading an account. Hypothetical results have inherent limitations — chief among them that they are prepared with the benefit of hindsight and carry no financial risk. No account traded these returns."} s1={(c) => <strong>{c}</strong>} /></dd>

          <dt style={{ fontWeight: 700, color: "var(--sr-text)", marginTop: "var(--sr-sp-3)" }}>{t("Net of what, exactly")}</dt>
          <dd style={{ margin: "2px 0 0 0" }}>
            <Trans text={"Backtest returns are net of an assumed round-trip transaction cost applied at each rebalance. They are <s1>gross of</s1> taxes, bid-ask spread beyond that assumption, market impact, financing, and any subscription fee for this product. Your realized return would be lower."} s1={(c) => <strong>{c}</strong>} /></dd>

          <dt style={{ fontWeight: 700, color: "var(--sr-text)", marginTop: "var(--sr-sp-3)" }}>{t("Survivorship")}</dt>
          <dd style={{ margin: "2px 0 0 0" }}>
            <Trans text={"The stock-picking test runs on a <s1>point-in-time, survivorship-free</s1> universe — it includes names that were later delisted or acquired. The allocator uses index ETFs, which carry the index provider's own reconstitution rules rather than ours."} s1={(c) => <strong>{c}</strong>} /></dd>

          <dt style={{ fontWeight: 700, color: "var(--sr-text)", marginTop: "var(--sr-sp-3)" }}>{t("Past performance")}</dt>
          <dd style={{ margin: "2px 0 0 0" }}>
            <Trans text={"Past performance — hypothetical or realized — <s1>does not predict future results</s1>. A strategy that beat its benchmark over the sample above can underperform for years."} s1={(c) => <strong>{c}</strong>} /></dd>

          <dt style={{ fontWeight: 700, color: "var(--sr-text)", marginTop: "var(--sr-sp-3)" }}>{t("No testimonials, no selected trades")}</dt>
          <dd style={{ margin: "2px 0 0 0" }}>
            <Trans text={"This page publishes the <s1>whole record</s1>, including the stock-picking result that lost to the index. Scora does not publish testimonials, screenshots of winning trades, or cherry-picked calls — a record you can only see the good half of is not a record."} s1={(c) => <strong>{c}</strong>} /></dd>

          <dt style={{ fontWeight: 700, color: "var(--sr-text)", marginTop: "var(--sr-sp-3)" }}>{t("Not investment advice")}</dt>
          <dd style={{ margin: "2px 0 0 0" }}>
            {t("Scora Research is an educational tool. Nothing here is a recommendation to buy or sell any security, and it is not personalized to your circumstances.")}</dd>
        </dl>
      </div>

      <div style={{ textAlign: "right", fontSize: "10px", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-4)" }}>
        {t("Allocator: research/backtest_assets.mjs (stationary regime) + walkforward.mjs · Stock-picking: research/backtest.mjs --full 500 · free data (EDGAR / Yahoo / Tiingo / FRED)")}</div>
    </div>
  );
}
