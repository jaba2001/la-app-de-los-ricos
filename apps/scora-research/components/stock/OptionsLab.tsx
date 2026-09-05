"use client";
// Options Lab — the income (theta) half of options, on free EOD data.
//
// Selling premium is what most retail options services actually monetize, and the two
// numbers that decide it are: is volatility rich right now relative to its own past, and
// what am I paid — annualized — for the capital I commit. Both come out of the price
// history this page already fetched.
//
// Two things this refuses to do, and says so on screen:
//   1. Call realized vol "IV". Without a paid chain there is no implied surface; using
//      realized vol as the pricing input is a proxy, and it is labelled as one.
//   2. Recommend selling puts on a name the engine itself scores badly — a cash-secured
//      put is a commitment to own the stock at the strike.

import { useMemo } from "react";
import {
  volRank, rollingRealizedVol, buildIncomePlan, incomeGate,
  type IncomeKind, type IncomePlan,
} from "@/lib/greeks";
import { toDatedCloses } from "@/lib/attribution";

interface Props {
  ticker: string;
  price: number | null;
  rate: number | null;
  /** Raw EOD rows — same array the rest of the page uses. */
  history: Record<string, unknown>[] | null | undefined;
  /** Macro-tilted Scora score, for the gate. */
  score: number | null;
}

const VOL_WINDOW = 21;   // ~1 trading month of realized vol
const RANK_LOOKBACK = 252;
const TENORS = [30, 45];
const CALL_OFFSETS = [0.02, 0.05, 0.10];
const PUT_OFFSETS = [-0.02, -0.05, -0.10];

const pct = (v: number, d = 1) => `${v.toFixed(d)}%`;

function planRows(kind: IncomeKind, spot: number, vol: number, rate: number): IncomePlan[] {
  const offsets = kind === "covered-call" ? CALL_OFFSETS : PUT_OFFSETS;
  const out: IncomePlan[] = [];
  for (const days of TENORS) {
    for (const off of offsets) {
      const p = buildIncomePlan(kind, spot, +(spot * (1 + off)).toFixed(2), { vol, rate, t: days / 365 });
      if (p) out.push(p);
    }
  }
  return out.sort((a, b) => b.annualizedYield - a.annualizedYield);
}

export default function OptionsLab({ ticker, price, rate, history, score }: Props) {
  const model = useMemo(() => {
    const closes = toDatedCloses(history).map((p) => p.close);
    if (closes.length < VOL_WINDOW + 2) return null;
    const series = rollingRealizedVol(closes.slice(0, RANK_LOOKBACK + VOL_WINDOW), VOL_WINDOW);
    if (series.length === 0) return null;
    const current = series[0];
    return { current, rank: volRank(current, series), spot: price ?? closes[0] };
  }, [history, price]);

  if (!model || !(model.spot > 0)) {
    return (
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        <div className="section-label">Options Lab</div>
        <div className="sr-hint">Not enough price history to rank volatility for {ticker}.</div>
      </div>
    );
  }

  const r = (rate ?? 4) / 100;
  const calls = planRows("covered-call", model.spot, model.current, r);
  const puts = planRows("cash-secured-put", model.spot, model.current, r);
  const callGate = incomeGate("covered-call", score);
  const putGate = incomeGate("cash-secured-put", score);
  const vr = model.rank;

  const gateColor = (tone: string) => tone === "pos" ? "var(--sr-pos)" : tone === "neg" ? "var(--sr-neg)" : "var(--sr-warn)";

  const table = (title: string, rows: IncomePlan[], gate: ReturnType<typeof incomeGate>) => (
    <div style={{ marginTop: "var(--sr-sp-4)" }}>
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)" }}>
        <div className="section-label" style={{ margin: 0 }}>{title}</div>
        <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: gateColor(gate.tone) }}>
          {gate.allowed ? "" : "Blocked · "}{gate.message}
        </span>
      </div>
      {!gate.allowed ? (
        <div className="sr-hint">
          The engine will not lay out a premium ladder for a commitment to buy this name.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="sr-table">
            <thead>
              <tr>
                <th>Strike</th>
                <th style={{ textAlign: "right" }}>Days</th>
                <th style={{ textAlign: "right" }}>Premium</th>
                <th style={{ textAlign: "right" }}>Ann. yield</th>
                <th style={{ textAlign: "right" }}>Assigned</th>
                <th style={{ textAlign: "right" }}>POP</th>
                <th style={{ textAlign: "right" }}>Break-even</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={`${p.kind}-${p.strike}-${p.days}`}>
                  <td className="num">{p.strike.toFixed(2)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{Math.round(p.days)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{p.premium.toFixed(2)}</td>
                  <td className="num" style={{ textAlign: "right", fontWeight: 700, color: "var(--sr-amber)" }}>{pct(p.annualizedYield)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{pct(p.probAssignment * 100, 0)}</td>
                  <td className="num" style={{ textAlign: "right", color: "var(--sr-pos)" }}>{pct(p.pop * 100, 0)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{p.breakEven.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)" }}>
        <div className="section-label" style={{ margin: 0 }}>Options Lab · income</div>
        <span className="sr-hint">spot {model.spot.toFixed(2)}</span>
      </div>

      {/* Is volatility rich right now, measured against its own past? */}
      <div className="sr-grid-4">
        <div className="sr-tile">
          <div className="sr-tile-label">Realized vol ({VOL_WINDOW}d)</div>
          <div className="num" style={{ fontSize: "var(--sr-t-md)", fontWeight: 700 }}>{pct(model.current * 100)}</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">Vol rank</div>
          <div className="num" style={{ fontSize: "var(--sr-t-md)", fontWeight: 700, color: vr && vr.rank >= 60 ? "var(--sr-pos)" : "var(--sr-text)" }}>
            {vr ? pct(vr.rank, 0) : "—"}
          </div>
          <div className="sr-hint">{vr ? vr.label : "not enough history"}</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">Vol percentile</div>
          <div className="num" style={{ fontSize: "var(--sr-t-md)", fontWeight: 700 }}>{vr ? pct(vr.percentile, 0) : "—"}</div>
          <div className="sr-hint">{vr ? `${vr.sampleSize} obs` : ""}</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">1y range</div>
          <div className="num" style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700 }}>
            {vr ? `${pct(vr.low * 100, 0)}–${pct(vr.high * 100, 0)}` : "—"}
          </div>
        </div>
      </div>

      {vr && (
        <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>
          {vr.rank >= 60
            ? "Volatility is rich versus its own year — premium selling is being paid comparatively well."
            : vr.rank <= 25
              ? "Volatility is cheap versus its own year — you are being paid little to take this risk."
              : "Volatility is around its own average — no edge from the vol level itself."}
        </div>
      )}

      {table("Covered calls", calls, callGate)}
      {table("Cash-secured puts", puts, putGate)}

      {/* The caveats, on screen rather than buried. */}
      <div className="sr-hint" style={{ marginTop: "var(--sr-sp-4)", borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-2)", lineHeight: 1.6 }}>
        Priced off <strong>realized</strong> volatility, not implied — without a paid options chain there is no
        live IV surface, so these premiums are a model estimate, not quotes. &quot;Assigned&quot; and &quot;POP&quot; are
        <strong> risk-neutral</strong> probabilities: what the market charges, not what will happen. Yields
        annualize a single period at 365/days and assume you can keep re-writing at the same terms — you
        usually cannot.
      </div>
    </div>
  );
}
