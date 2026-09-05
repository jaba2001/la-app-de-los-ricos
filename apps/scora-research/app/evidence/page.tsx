// ─────────────────────────────────────────────────────────────────────────────
// LIBRO DE EVIDENCIA (F0c) — PLAN_TEORIA_FINANCIERA_SCORA.md §2.3.
//
// Todo lo que Scora mide vivía en research/out/*.json y en documentos internos: el activo
// más diferencial del producto estaba apagado. Esta página lo enciende — incluidas las
// señales que FALLARON, que son las que nadie más publica.
//
// Server component a propósito: los artefactos se empaquetan en build, así que la página
// es estática, pública y no puede desincronizarse de los JSON que el golden test vigila.
// ─────────────────────────────────────────────────────────────────────────────
import type { Metadata } from "next";
import signalsIc from "@/research/out/signals_ic.json";
import backtestSummary from "@/research/out/backtest_summary.json";
import portfolioBacktest from "@/research/out/portfolio_backtest.json";
import trialsLedger from "@/research/out/trials_ledger.json";
import { gradeSignal, GRADE_COLOR, GRADE_LABEL, MDE_IC, type OosStatus } from "@/lib/signalGrade";
import { FACTOR_LABEL } from "@/lib/ensemble";

export const metadata: Metadata = {
  title: "Evidence ledger · Scora",
  description:
    "Every signal Scora measures, with its measured information coefficient, out-of-sample verdict and sample size — including the ones that failed.",
};

const REGIMES = ["low", "mid", "high"] as const;
const REGIME_LABEL: Record<string, string> = {
  low: "Correlación baja",
  mid: "Correlación media",
  high: "Correlación alta",
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const ic3 = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(3)}`;

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="sr-tile">
      <div className="sr-tile-label">{label}</div>
      <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: color ?? "var(--sr-text)" }}>{value}</div>
      {sub && <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

export default function EvidencePage() {
  const sig = portfolioBacktest.significance;
  const nameMonths = backtestSummary.nameMonths as number;
  const universe = backtestSummary.universe as number;
  const rebalances = backtestSummary.rebalances as number;
  const totalTrials = trialsLedger.totalTrials as number;
  const factorIC = signalsIc.factorIC as Record<string, number[]>;
  const ensembleOOS = (backtestSummary as { correlation?: { ensembleOOS?: { verdict?: string; pass?: boolean; ensembleIC?: number; scoreIC?: number; testMonths?: number; split?: string } } }).correlation?.ensembleOOS;

  // Cada factor se nota con su MEJOR régimen: es la lectura más favorable posible, y aun
  // así casi ninguno pasa de C. Presentarlo del lado generoso hace el punto más fuerte.
  const rows = Object.entries(factorIC).map(([factor, ics]) => {
    const best = ics.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
    const graded = gradeSignal({
      ic: best,
      oos: "not-tested" as OosStatus,
      sampleSize: nameMonths,
      pointInTime: true,
      trials: totalTrials,
    });
    return { factor, ics, best, graded };
  }).sort((a, b) => b.graded.points - a.graded.points);

  return (
    <main className="container" style={{ paddingTop: "var(--sr-sp-6)", paddingBottom: "var(--sr-sp-7)" }}>
      <h1 style={{ fontSize: "var(--sr-t-3xl)", fontWeight: 800, marginBottom: "var(--sr-sp-2)" }}>Evidence ledger</h1>
      <p style={{ color: "var(--sr-text-2)", maxWidth: 720, lineHeight: 1.65, marginBottom: "var(--sr-sp-5)" }}>
        Every signal in this product, with what it actually measured — <strong>including the ones that failed</strong>.
        Fama&rsquo;s joint-hypothesis problem says market efficiency can never be tested on its own: you always test
        efficiency <em>and</em> a model of expected returns together, so any &ldquo;edge&rdquo; may just be a bad model.
        There is no clean test. The honest response isn&rsquo;t silence — it&rsquo;s showing the working.
      </p>

      {/* ── El titular ── */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="section-label">The headline: stock selection does not beat the index</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
          <Tile label="Information coefficient" value={ic3(backtestSummary.informationCoefficient as number)} sub="score vs forward return · ~0 is no predictive power" />
          <Tile label="PSR vs SPY" value={pct(sig.PSR_vs_SPY)} sub="want >95% · probability the true Sharpe beats SPY" color="var(--sr-neg)" />
          <Tile label="Top-minus-bottom decile" value={`${(backtestSummary.topMinusBottom as number).toFixed(2)}%`} sub="best decile minus worst — negative is backwards" color="var(--sr-neg)" />
          <Tile label="Universe" value={`${universe} names`} sub={`${rebalances} monthly rebalances · point-in-time membership`} />
        </div>
        <div style={{ padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--sr-neg) 22%, transparent)", fontSize: "var(--sr-t-sm)", lineHeight: 1.6 }}>
          <strong>Verdict:</strong> {portfolioBacktest.verdict}
        </div>
        <p className="sr-hint" style={{ marginTop: "var(--sr-sp-2)", lineHeight: 1.6 }}>
          This is the finding the rest of the product is built around. Proving honestly that you <em>cannot</em> beat
          the index by picking stocks on free data is the moat, not the failure — Grossman &amp; Stiglitz (1980) showed
          markets can&rsquo;t be perfectly efficient either, because then nobody would pay to gather information. The
          return to research exists; it just isn&rsquo;t where retail products claim it is.
        </p>
        <p className="sr-hint" style={{ marginTop: "var(--sr-sp-2)", lineHeight: 1.6 }}>
          Scope matters: this is measured on <strong>US large caps with free data</strong>. It is not a claim that no
          one can ever beat an index. Where margin plausibly remains — less efficient universes, factor combinations
          gated by regime, risk and drawdown control rather than selection — is a different question, and one that has
          to be answered with the same measurement discipline rather than asserted.
        </p>
      </div>

      {/* ── Deflación ── */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="section-label">How hard we deflate for having searched</div>
        <p className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.6, maxWidth: 720 }}>
          Test 200 worthless strategies, keep the best, and it will show a healthy Sharpe by luck alone. The deflated
          Sharpe (Bailey &amp; López de Prado) asks the only question that matters: <em>is this better than the best you&rsquo;d
          expect from M attempts at nothing?</em> The threshold rises with M — so we publish M.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--sr-sp-2)" }}>
          <Tile label="Trials in this script" value={String(sig.trials)} sub="what the backtest itself swept" />
          <Tile label="Trials on the same data" value={String(totalTrials)} sub={`across ${trialsLedger.artifacts} saved artifacts — a lower bound`} />
          <Tile label="Deflated Sharpe · optimistic" value={pct(sig.DSR)} sub="using this script's M and variance" />
          <Tile label="Deflated Sharpe · conservative" value={pct(sig.DSR_cumulative as number)} sub="using the full trial count and pooled dispersion" color="var(--sr-neg)" />
        </div>
        <p className="sr-hint" style={{ marginTop: "var(--sr-sp-3)", lineHeight: 1.6 }}>
          The truth sits between those two bounds: pooling different strategy families inflates the variance beyond
          what the framework assumes, while counting only this script&rsquo;s three configurations plainly understates the
          search. Neither bound rescues the verdict — it already fails on PSR. And the trial count is a <strong>lower
          bound</strong>: it only counts variants that left a file behind.
        </p>
      </div>

      {/* ── IC por factor ── */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="section-label">Every factor, graded</div>
        <p className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.6, maxWidth: 720 }}>
          Measured information coefficient per correlation regime, from a survivorship-free run
          ({nameMonths.toLocaleString("en")} name-months). Each factor is graded on its <em>best</em> regime — the most
          generous reading available — and the grade is still mostly C and D. That is the point.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="sr-table">
            <thead>
              <tr>
                <th>Factor</th>
                {REGIMES.map((r) => <th key={r} style={{ textAlign: "right" }}>{REGIME_LABEL[r]}</th>)}
                <th style={{ textAlign: "right" }}>Best</th>
                <th style={{ textAlign: "center" }}>Grade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ factor, ics, best, graded }) => (
                <tr key={factor}>
                  <td style={{ fontWeight: 600 }}>{FACTOR_LABEL[factor] ?? factor}</td>
                  {ics.map((v, i) => (
                    <td key={i} style={{ textAlign: "right", color: v > 0 ? "var(--sr-text-2)" : "var(--sr-text-3)" }} className="num">{ic3(v)}</td>
                  ))}
                  <td style={{ textAlign: "right", fontWeight: 700 }} className="num">{ic3(best)}</td>
                  <td style={{ textAlign: "center" }}>
                    <span style={{ display: "inline-block", minWidth: 24, padding: "2px 8px", borderRadius: "var(--sr-radius)", fontWeight: 800, color: GRADE_COLOR[graded.grade], background: `color-mix(in srgb, ${GRADE_COLOR[graded.grade]} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${GRADE_COLOR[graded.grade]} 30%, transparent)` }}>
                      {graded.grade}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginTop: "var(--sr-sp-3)" }}>
          {(["A", "B", "C", "D"] as const).map((g) => (
            <div key={g} className="sr-hint">
              <strong style={{ color: GRADE_COLOR[g] }}>{g}</strong> — {GRADE_LABEL[g]}
            </div>
          ))}
        </div>
      </div>

      {/* ── Lo que falló ── */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="section-label">What failed, and stayed failed</div>
        {ensembleOOS ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
              <Tile label="Ensemble OOS IC" value={ic3(ensembleOOS.ensembleIC)} sub="frozen train-window weights, tested out of sample" color="var(--sr-neg)" />
              <Tile label="Monolithic score OOS IC" value={ic3(ensembleOOS.scoreIC)} sub="the incumbent it had to beat" />
              <Tile label="Test months" value={String(ensembleOOS.testMonths ?? "—")} sub={`split at ${ensembleOOS.split ?? "—"}`} />
              <Tile label="Gate" value={ensembleOOS.pass ? "PASSED" : "FAILED"} sub="must be >0 AND beat the score" color={ensembleOOS.pass ? "var(--sr-pos)" : "var(--sr-neg)"} />
            </div>
            <p className="sr-hint" style={{ lineHeight: 1.6 }}>
              The IC-weighted ensemble — the most sophisticated thing in the codebase — was tested out of sample against
              the plain score and <strong>lost</strong>. So it stays informational: visible in the UI as context, never
              feeding the score. Signals do not get promoted because they are clever; they get promoted by clearing a gate.
            </p>
          </>
        ) : (
          <p className="sr-hint">Out-of-sample gate artifact not present in this build.</p>
        )}
      </div>

      {/* ── Metodología ── */}
      <div className="card">
        <div className="section-label">How to read this page</div>
        <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--sr-text-2)", fontSize: "var(--sr-t-sm)", lineHeight: 1.75 }}>
          <li>Every number comes from a committed artifact in <code>research/out/</code>. The test suite fails if a file is missing or if the constants shipped in the code drift from it.</li>
          <li>
            An information coefficient near zero means <em>no predictive power</em>. More precisely: this universe&rsquo;s
            <strong>minimum detectable effect is IC {MDE_IC}</strong> at 80% power (measured — the cross-sectional IC has
            a standard deviation of ~0.22, so 192 months buys you that much resolution and no more). Below it a
            coefficient is not &ldquo;weak&rdquo;, it is <em>undetectable</em>: confirming an IC of 0.02 would take
            seventy-seven years of data. Grades score it as zero, not as partial credit.
          </li>
          <li>
            Benchmark caveat: the headline compares against SPY. A cap-weighted index is not the only fair yardstick —
            the same signal can beat SPY and lose badly against its own equal-weighted universe, which is the benchmark
            that shares the universe&rsquo;s selection bias. Read single-benchmark claims here, including ours, with that in mind.
          </li>
          <li>Grades penalise multiplicity: {totalTrials} trials on the same history raise the bar for all of them. Only one market history exists, and every pass spends it.</li>
          <li>Point-in-time universe means delisted and removed names are included as of each date — no survivorship bias inflating the result.</li>
          <li>Past measurement is not a forecast. Nothing here is investment advice.</li>
        </ul>
        <p className="sr-hint" style={{ marginTop: "var(--sr-sp-3)" }}>
          Artifacts generated {new Date(signalsIc.generatedAt as string).toISOString().slice(0, 10)} · trial ledger {new Date(trialsLedger.generatedAt as string).toISOString().slice(0, 10)}
        </p>
      </div>
    </main>
  );
}
