"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { GROWTH_BACKTEST as G } from "@/lib/trackRecord";
import "./landing-v2.css";

// Landing v2 — light "ink, paper, evergreen" system (see app/landing-v2.css).
// Every figure comes from lib/trackRecord.ts so the page can never drift from the
// published record, including the rows where the S&P wins.

const signed = (v: number, d = 0) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`;
const dd = (v: number) => `−${Math.abs(v).toFixed(1)}%`;

type Row = { k: string; us: number; spy: number; b64: number; fmt: (v: number) => string; higherIsBetter: boolean };
const ROWS: Row[] = [
  { k: "Total return", us: G.strategy.totalReturn, spy: G.spy.totalReturn, b64: G.bench6040.totalReturn, fmt: (v) => signed(v), higherIsBetter: true },
  { k: "Annual return (CAGR)", us: G.strategy.cagr, spy: G.spy.cagr, b64: G.bench6040.cagr, fmt: (v) => `${v.toFixed(2)}%`, higherIsBetter: true },
  { k: "Sharpe ratio", us: G.strategy.sharpe, spy: G.spy.sharpe, b64: G.bench6040.sharpe, fmt: (v) => v.toFixed(2), higherIsBetter: true },
  { k: "Sortino ratio", us: G.strategy.sortino, spy: G.spy.sortino, b64: G.bench6040.sortino, fmt: (v) => v.toFixed(2), higherIsBetter: true },
  { k: "Max drawdown", us: G.strategy.maxDrawdown, spy: G.spy.maxDrawdown, b64: G.bench6040.maxDrawdown, fmt: dd, higherIsBetter: true },
  { k: "Calmar ratio", us: G.strategy.calmar, spy: G.spy.calmar, b64: G.bench6040.calmar, fmt: (v) => v.toFixed(2), higherIsBetter: true },
];

function Cell({ v, best, us, fmt }: { v: number; best: boolean; us?: boolean; fmt: (v: number) => string }) {
  return <td className={best ? `best${us ? " us" : ""}` : undefined}>{best ? "● " : ""}{fmt(v)}</td>;
}

function LogoMark() {
  return (
    <span className="lv2-logo-mark" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 12L6 7L9 10L13 4" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="13" cy="4" r="1.6" fill="var(--lv-gold)" />
      </svg>
    </span>
  );
}

export default function Landing() {
  const { session, loading } = useAuth();
  const router = useRouter();

  // Logged-in visitors go straight to the app; the landing is for everyone else.
  useEffect(() => { if (!loading && session) router.replace("/macro"); }, [session, loading, router]);
  if (session) return null;

  const ddRatio = Math.abs(G.strategy.maxDrawdown) / Math.abs(G.spy.maxDrawdown);

  return (
    <div className="lv2">
      <header className="lv2-header">
        <div className="lv2-wrap">
          <Link href="/" className="lv2-logo" aria-label="Scora home">
            <LogoMark />
            <span className="lv2-logo-word">Scora</span>
          </Link>
          <nav className="lv2-nav" aria-label="Main">
            <Link href="/demo">How it works</Link>
            <Link href="/track-record">Track record</Link>
            <Link href="/evidence">Evidence</Link>
            <Link href="/pricing">Pricing</Link>
          </nav>
          <div className="lv2-header-actions">
            <Link href="/login" className="lv2-signin">Sign in</Link>
            <Link href="/login" className="lv2-btn lv2-btn-dark lv2-btn-sm">Start free</Link>
          </div>
        </div>
      </header>

      <section className="lv2-hero">
        <div className="lv2-wrap">
          <div>
            <div className="lv2-eyebrow">Every result published — including the ones against us</div>
            <h1 className="lv2-h1 serif">Investing, with the evidence in plain sight.</h1>
            <p className="lv2-lede">
              Scora is a regime-driven allocation engine that shows its work: validated out-of-sample,
              measured net of costs, and paired with an AI layer that can&apos;t invent a number.
            </p>
            <div className="lv2-ctas">
              <Link href="/login" className="lv2-btn lv2-btn-primary">Start free</Link>
              <Link href="/demo" className="lv2-btn lv2-btn-outline">Try the live demo</Link>
            </div>
            <div className="lv2-fineprint">
              Free core, forever · No card required · Educational research, not investment advice. Capital at risk.
            </div>
          </div>

          <figure className="lv2-card" style={{ margin: 0 }} aria-labelledby="lv2-card-title">
            <div className="lv2-card-head">
              <div>
                <div className="lv2-card-title" id="lv2-card-title">Growth mandate vs S&amp;P 500</div>
                <div className="lv2-card-sub">{G.period} · {G.months} months · net of costs</div>
              </div>
              <span className="lv2-tag">BACKTEST</span>
            </div>
            <div className="lv2-legend">
              <span><span className="lv2-swatch" style={{ background: "var(--lv-brand)" }} />Scora Growth</span>
              <span><span className="lv2-swatch" style={{ background: "var(--lv-bench)" }} />S&amp;P 500</span>
            </div>
            <div>
              <div className="lv2-bar-label">Worst peak-to-trough fall</div>
              <div className="lv2-bars">
                <div className="lv2-bar-row" title={`Scora Growth ${dd(G.strategy.maxDrawdown)}`}>
                  <div className="lv2-bar-track"><div className="lv2-bar-fill" style={{ width: `${ddRatio * 100}%`, background: "var(--lv-brand)" }} /></div>
                  <span className="lv2-bar-val num">{dd(G.strategy.maxDrawdown)}</span>
                </div>
                <div className="lv2-bar-row" title={`S&P 500 ${dd(G.spy.maxDrawdown)}`}>
                  <div className="lv2-bar-track"><div className="lv2-bar-fill" style={{ width: "100%", background: "var(--lv-bench)" }} /></div>
                  <span className="lv2-bar-val num">{dd(G.spy.maxDrawdown)}</span>
                </div>
              </div>
            </div>
            <div className="lv2-card-stats">
              <div><div className="lv2-stat-k">Sharpe</div><div className="lv2-stat-v num">{G.strategy.sharpe.toFixed(2)}</div><div className="lv2-stat-k">S&amp;P {G.spy.sharpe.toFixed(2)}</div></div>
              <div><div className="lv2-stat-k">Sortino</div><div className="lv2-stat-v num">{G.strategy.sortino.toFixed(2)}</div><div className="lv2-stat-k">S&amp;P {G.spy.sortino.toFixed(2)}</div></div>
              <div><div className="lv2-stat-k">Total return</div><div className="lv2-stat-v num">{signed(G.strategy.totalReturn)}</div><div className="lv2-stat-k">S&amp;P {signed(G.spy.totalReturn)}</div></div>
            </div>
            <figcaption className="lv2-note">
              The S&amp;P returned more in raw terms, and the Sharpe edge isn&apos;t statistically significant
              (t = {G.significacion.tVsSpy}). We publish both.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="lv2-facts" aria-label="Key facts">
        <div className="lv2-wrap">
          <div className="lv2-facts-grid">
            <div className="lv2-fact"><div className="lv2-fact-n serif">{G.months}</div><div className="lv2-fact-d">months backtested, 2008 included, net of costs</div></div>
            <div className="lv2-fact"><div className="lv2-fact-n serif">{G.deflacion.ensayos}</div><div className="lv2-fact-d">strategy trials disclosed — not just the winner</div></div>
            <div className="lv2-fact"><div className="lv2-fact-n serif">0×</div><div className="lv2-fact-d">leverage, ever</div></div>
            <div className="lv2-fact"><div className="lv2-fact-n serif">€0</div><div className="lv2-fact-d">for the full engine, forever</div></div>
          </div>
        </div>
      </section>

      <section className="lv2-section">
        <div className="lv2-wrap">
          <div className="lv2-split-head">
            <h2 className="lv2-h2 serif">Top-down, one layer at a time.</h2>
            <p className="lv2-body">
              The long cycle sets the ceiling, the regime sets the tilt, and a breadth loop flags when the macro
              read and the market disagree — an early warning, not a forecast.
            </p>
          </div>
          <div className="lv2-steps">
            {[
              ["01", "Secular clock", "Valuation and the long cycle set the baseline equity weight."],
              ["02", "Risk-on allocation", "Liquidity, recession risk and financial stress tilt the mix across assets."],
              ["03", "Sector rotation", "The regime picks which parts of the market to lean into."],
              ["04", "Selection, gated", "Stock picking gets weight only when correlation says it can matter."],
            ].map(([n, t, d]) => (
              <div className="lv2-step" key={n}>
                <span className="lv2-step-n num">{n}</span>
                <div className="lv2-step-t">{t}</div>
                <div className="lv2-step-d">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lv2-section-alt">
        <div className="lv2-wrap lv2-score">
          <div className="lv2-score-intro">
            <h2 className="lv2-h2 serif">Where we win. And where we don&apos;t.</h2>
            <p className="lv2-body">
              Most platforms show you the chart that flatters them. We show the whole table — against the index and
              a plain 60/40 — so you can judge the trade-off yourself.
            </p>
            <Link href="/track-record" className="lv2-link">See the full track record →</Link>
          </div>
          <table className="lv2-table">
            <caption>{G.period} · monthly · net of costs · rf = T-bills. Best in each row marked ●.</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col" className="lv2-us">Scora Growth</th>
                <th scope="col">S&amp;P 500</th>
                <th scope="col">60/40</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const best = Math.max(r.us, r.spy, r.b64);
                return (
                  <tr key={r.k}>
                    <th scope="row">{r.k}</th>
                    <Cell v={r.us} best={r.us === best} us fmt={r.fmt} />
                    <Cell v={r.spy} best={r.spy === best} fmt={r.fmt} />
                    <Cell v={r.b64} best={r.b64 === best} fmt={r.fmt} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="lv2-section">
        <div className="lv2-wrap">
          <h2 className="lv2-h2 serif" style={{ maxWidth: 640 }}>Built to be checked, not just trusted.</h2>
          <div className="lv2-trust">
            <div className="lv2-trust-item">
              <span className="lv2-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg></span>
              <div className="lv2-trust-t">AI with a hard gate</div>
              <div className="lv2-trust-d">Every figure an AI answer emits is checked in code against the data it was given. Anything unverified is flagged.</div>
            </div>
            <div className="lv2-trust-item">
              <span className="lv2-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4h8l4 4v12H4V4h4z" /><path d="M8 12h8M8 16h5" /></svg></span>
              <div className="lv2-trust-t">A public audit trail</div>
              <div className="lv2-trust-d">Each AI run is logged with its sources and its grounding result, so you can read exactly what it relied on.</div>
            </div>
            <div className="lv2-trust-item">
              <span className="lv2-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19h16" /><path d="M6 15l4-4 3 3 5-6" /></svg></span>
              <div className="lv2-trust-t">Out-of-sample, survivorship-free</div>
              <div className="lv2-trust-d">Walk-forward tests on point-in-time data, with the number of attempts published next to the result.</div>
            </div>
            <div className="lv2-trust-item">
              <span className="lv2-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg></span>
              <div className="lv2-trust-t">A live fund, in the open</div>
              <div className="lv2-trust-d">An autonomous paper fund runs the strategy forward, every rebalance visible — no hindsight possible.</div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="lv2-wrap lv2-pricing">
          <div className="lv2-pricing-intro">
            <h2 className="lv2-h2 serif">Free where it matters.</h2>
            <p className="lv2-body">The engine runs on free data, so the analysis stays free. Pro only adds convenience.</p>
          </div>
          <div className="lv2-plan">
            <div className="lv2-plan-head"><span className="lv2-plan-name">Free</span><span className="lv2-plan-price serif">€0</span></div>
            <ul>
              <li>Macro regime + validated allocator</li>
              <li>Live track record &amp; AI audit trail</li>
              <li>Stock, bond &amp; instrument analysis</li>
              <li>Daily AI analyses</li>
              <li>Discovery screener</li>
            </ul>
            <Link href="/login" className="lv2-btn lv2-btn-primary">Start free</Link>
          </div>
          <div className="lv2-plan">
            <div className="lv2-plan-head">
              <span className="lv2-plan-name">Pro<span className="lv2-plan-soon">Coming soon</span></span>
            </div>
            <ul>
              <li>Everything in Free</li>
              <li>Higher daily AI limits</li>
              <li>Regime-change &amp; divergence alerts</li>
              <li>Watchlist signal notifications</li>
              <li>Research-note export</li>
            </ul>
            <Link href="/pricing" className="lv2-btn lv2-btn-outline">See pricing</Link>
          </div>
        </div>
      </section>

      <section className="lv2-wrap">
        <div className="lv2-band">
          <div>
            <h2 className="lv2-h2 serif">See today&apos;s regime before you sign up.</h2>
            <p>The live read the engine runs on — no account needed.</p>
          </div>
          <div className="lv2-band-ctas">
            <Link href="/demo" className="lv2-btn lv2-btn-light">Open the live demo</Link>
            <Link href="/login" className="lv2-btn lv2-btn-ghost-dark">Start free</Link>
          </div>
        </div>
      </section>

      <footer className="lv2-footer">
        <div className="lv2-wrap">
          <div className="lv2-footer-grid">
            <div className="lv2-footer-col">
              <strong style={{ fontSize: 17 }}>Scora</strong>
              <span style={{ color: "var(--lv-muted)", maxWidth: 320 }}>Regime-driven research, measured in public.</span>
            </div>
            <nav className="lv2-footer-col" aria-label="Product">
              <strong>Product</strong>
              <Link href="/demo">Live demo</Link>
              <Link href="/daily">Daily close</Link>
              <Link href="/pricing">Pricing</Link>
            </nav>
            <nav className="lv2-footer-col" aria-label="Evidence">
              <strong>Evidence</strong>
              <Link href="/track-record">Track record</Link>
              <Link href="/evidence">Evidence ledger</Link>
              <Link href="/audit">AI audit trail</Link>
            </nav>
          </div>
          <p className="lv2-legal">
            Scora Research is an educational tool for informational purposes only and is not investment advice.
            Scores, valuations, backtests and AI commentary are estimates that may be wrong or out of date; verify
            independently before making any decision. Backtested results are hypothetical. Past performance does not
            predict future results. Capital at risk. Data from FRED, Finnhub, FMP, SEC EDGAR and other public sources.
          </p>
        </div>
      </footer>
    </div>
  );
}
