"use client";
import { useMemo, useState, useEffect } from "react";
import {
  blackScholes, breakEven, payoffAtExpiry, buildStrategy, STRATEGY_LABELS,
  impliedVol, impliedProbability, noArbitrageBounds,
  type OptionType, type StrategyName,
} from "@/lib/greeks";

interface Props { ticker: string; price: number | null; rate: number | null; }

const numInput: React.CSSProperties = {
  width: 90, background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)",
  borderRadius: "var(--sr-radius)", color: "var(--sr-text)", padding: "5px 8px", fontSize: "var(--sr-t-sm)", outline: "none",
};

function Field({ label, value, onChange, step = 1, min }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
      {label}
      <input type="number" value={Number.isFinite(value) ? value : ""} step={step} min={min} onChange={(e) => onChange(Number(e.target.value))} style={numInput} className="num" />
    </label>
  );
}

export default function OptionsCalc({ ticker, price, rate }: Props) {
  const [type, setType] = useState<OptionType>("call");
  const [spot, setSpot] = useState<number>(price ?? 100);
  const [strike, setStrike] = useState<number>(price != null ? Math.round(price) : 100);
  const [days, setDays] = useState<number>(30);
  const [ivPct, setIvPct] = useState<number>(30);
  const [ratePct, setRatePct] = useState<number>(rate != null ? Number(rate) : 4.2);
  const [divPct, setDivPct] = useState<number>(0);
  const [touched, setTouched] = useState(false); // once the user edits, stop auto-prefilling

  // Prefill from live data when it arrives — but NEVER overwrite a value the user has edited.
  useEffect(() => { if (!touched && price != null) { setSpot(price); setStrike(Math.round(price)); } }, [price, touched]);
  useEffect(() => { if (!touched && rate != null) setRatePct(Number(rate)); }, [rate, touched]);

  // Wrap a setter so any manual edit flips `touched` and freezes the prefill.
  const mark = (fn: (n: number) => void) => (n: number) => { setTouched(true); fn(n); };

  const g = useMemo(
    () => blackScholes(spot, strike, days / 365, ivPct / 100, ratePct / 100, divPct / 100, type),
    [spot, strike, days, ivPct, ratePct, divPct, type]
  );
  const be = breakEven(strike, g.price, type);

  // ── Medición: precio de mercado → volatilidad implícita ──────────────────────
  // El giro que convierte la calculadora en instrumento: en vez de teclear una vol y
  // obtener un precio, metes el precio que cotiza y sale la vol que ese precio implica.
  const [marketPx, setMarketPx] = useState<number>(0);
  const solved = useMemo(
    () => (marketPx > 0 ? impliedVol(marketPx, spot, strike, days / 365, ratePct / 100, divPct / 100, type) : null),
    [marketPx, spot, strike, days, ratePct, divPct, type]
  );
  const bounds = useMemo(
    () => noArbitrageBounds(spot, strike, days / 365, ratePct / 100, divPct / 100, type),
    [spot, strike, days, ratePct, divPct, type]
  );
  // Probabilidad neutral al riesgo de acabar por encima del strike: N(d2). Usa la vol
  // resuelta si la hay, y si no la tecleada.
  const prob = useMemo(
    () => impliedProbability(spot, strike, days / 365, (solved ? solved.vol * 100 : ivPct) / 100, ratePct / 100, divPct / 100),
    [spot, strike, days, solved, ivPct, ratePct, divPct]
  );

  const [strategy, setStrategy] = useState<StrategyName>("collar");
  const strat = useMemo(
    () => buildStrategy(strategy, spot, { vol: ivPct / 100, rate: ratePct / 100, q: divPct / 100, t: days / 365 }),
    [strategy, spot, ivPct, ratePct, divPct, days]
  );

  const payoffPts = useMemo(() => {
    const mults = [-0.2, -0.1, 0, 0.1, 0.2];
    return mults.map((m) => {
      const s = spot * (1 + m);
      return { label: `${m >= 0 ? "+" : ""}${(m * 100).toFixed(0)}%`, spot: s, pnl: payoffAtExpiry(s, strike, g.price, type) };
    });
  }, [spot, strike, g.price, type]);

  const stat = (label: string, val: string, sub?: string) => (
    <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
      <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 800 }} className="num">{val}</div>
      {sub && <div style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>{sub}</div>}
    </div>
  );

  return (
    <div className="animate-fade-in">
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        <div className="section-label">Options calculator · Black-Scholes · {ticker}</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.5 }}>
          Price a European option and its Greeks from your own inputs. Free &amp; educational — a pricing tool, not a live options-flow feed. Rate prefilled from the Treasury curve.
        </div>

        {/* Type toggle */}
        <div style={{ display: "flex", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
          {(["call", "put"] as OptionType[]).map((t) => (
            <button key={t} className={`subtab ${type === t ? "active" : ""}`} onClick={() => setType(t)} style={{ textTransform: "capitalize" }}>{t}</button>
          ))}
        </div>

        {/* Inputs */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)" }}>
          <Field label="Spot $" value={spot} onChange={mark(setSpot)} step={0.5} min={0} />
          <Field label="Strike $" value={strike} onChange={mark(setStrike)} step={0.5} min={0} />
          <Field label="Days to expiry" value={days} onChange={mark(setDays)} step={1} min={0} />
          <Field label="Implied vol %" value={ivPct} onChange={mark(setIvPct)} step={1} min={0} />
          <Field label="Risk-free %" value={ratePct} onChange={mark(setRatePct)} step={0.1} />
          <Field label="Div yield %" value={divPct} onChange={mark(setDivPct)} step={0.1} min={0} />
        </div>

        {/* Price + Greeks */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: "var(--sr-sp-2)" }}>
          {stat("Fair value", `$${g.price.toFixed(2)}`, "per share")}
          {stat("Delta", g.delta.toFixed(3), "Δ per $1 spot")}
          {stat("Gamma", g.gamma.toFixed(4), "Δ of Δ")}
          {stat("Vega", (g.vega / 100).toFixed(3), "per +1% IV")}
          {stat("Theta/day", g.thetaPerDay.toFixed(3), "time decay")}
          {stat("Rho", (g.rho / 100).toFixed(3), "per +1% rate")}
          {stat("Break-even", `$${be.toFixed(2)}`, `${((be / spot - 1) * 100).toFixed(1)}% from spot`)}
        </div>
      </div>

      {/* Medición: qué está descontando el mercado */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        <div className="section-label">What the market is pricing</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.5 }}>
          Above, you type a volatility and get a price. Here it runs the other way: paste the option&rsquo;s
          <strong> market price</strong> (your broker shows it free) and Black-Scholes is inverted to recover the
          volatility that price implies. That number is the market&rsquo;s forecast — not yours.
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-3)", alignItems: "flex-end", marginBottom: "var(--sr-sp-3)" }}>
          <Field label="Market price $" value={marketPx} onChange={setMarketPx} step={0.05} min={0} />
          {solved && (
            <button
              className="btn-primary"
              onClick={() => { setTouched(true); setIvPct(Number((solved.vol * 100).toFixed(2))); }}
              style={{ padding: "8px 14px", fontSize: "var(--sr-t-sm)" }}
            >
              Use {(solved.vol * 100).toFixed(1)}% above
            </button>
          )}
        </div>

        {marketPx > 0 && !solved && (
          <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-warn) 10%, transparent)", color: "var(--sr-warn)", fontSize: "var(--sr-t-xs)", lineHeight: 1.5 }}>
            No implied volatility can be recovered from ${marketPx.toFixed(2)}.
            {marketPx < bounds.lo || marketPx > bounds.hi
              ? <> That price is outside the no-arbitrage range (${bounds.lo.toFixed(2)} – ${bounds.hi.toFixed(2)}), so no volatility reproduces it — check the inputs.</>
              : <> This contract is so deep in- or out-of-the-money that its price barely depends on volatility, so the number is not identifiable. Showing one anyway would be false precision.</>}
          </div>
        )}

        {solved && prob && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--sr-sp-2)" }}>
              {stat("Implied vol", `${(solved.vol * 100).toFixed(1)}%`, `± ${(solved.volUncertainty * 100).toFixed(2)} pts`)}
              {stat("Your input", `${ivPct.toFixed(1)}%`, `${solved.vol * 100 > ivPct ? "market is higher" : "market is lower"}`)}
              {stat("P(above strike)", `${(prob.above * 100).toFixed(1)}%`, "risk-neutral, N(d2)")}
              {stat("P(below strike)", `${(prob.below * 100).toFixed(1)}%`, "risk-neutral")}
              {stat("1σ move", `±${prob.expectedMovePct.toFixed(1)}%`, `to expiry (${days}d)`)}
            </div>
            <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)", lineHeight: 1.6 }}>
              N(d2) is a <strong>risk-neutral</strong> probability, not a real-world one: it embeds the risk premium
              investors charge for bearing the outcome, so it systematically overstates downside. Read it as
              &ldquo;what the market charges&rdquo;, never as &ldquo;what will happen&rdquo;.
            </div>
          </>
        )}
      </div>

      {/* Payoff at expiry */}
      <div className="card">
        <div className="section-label">Payoff at expiry (long, net of premium)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "var(--sr-sp-2)" }}>
          {payoffPts.map((p) => (
            <div key={p.label} style={{ padding: "var(--sr-sp-2)", borderRadius: "var(--sr-radius)", textAlign: "center", background: `color-mix(in srgb, ${p.pnl >= 0 ? "var(--sr-pos)" : "var(--sr-neg)"} 10%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${p.pnl >= 0 ? "var(--sr-pos)" : "var(--sr-neg)"} 24%, transparent)` }}>
              <div className="sr-hint">{p.label} · ${p.spot.toFixed(0)}</div>
              <div className="num" style={{ fontSize: "var(--sr-t-base)", fontWeight: 800, color: p.pnl >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }}>
                {p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
        <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>Max loss on a long option = the premium (${g.price.toFixed(2)}). Break-even at ${be.toFixed(2)}.</div>
      </div>

      {/* Multi-leg strategies (Fase 4) */}
      <div className="card" style={{ marginTop: "var(--sr-sp-4)" }}>
        <div className="section-label">Estrategias multi-pata</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.5 }}>
          Estructuras armadas alrededor del spot (strikes ATM / ±5-10%), valoradas con Black-Scholes y tus inputs. Ideal para proteger un holding (collar) o definir riesgo (spreads).
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-1)", marginBottom: "var(--sr-sp-3)" }}>
          {(Object.keys(STRATEGY_LABELS) as StrategyName[]).map((s) => (
            <button key={s} className={`subtab ${strategy === s ? "active" : ""}`} onClick={() => setStrategy(s)}>{STRATEGY_LABELS[s]}</button>
          ))}
        </div>

        {strat ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
              {stat("Net " + (strat.netPremium >= 0 ? "debit" : "credit"), `$${Math.abs(strat.netPremium).toFixed(2)}`, strat.netPremium >= 0 ? "paid" : "received")}
              {stat("Max profit", strat.maxProfit == null ? "∞" : `$${strat.maxProfit.toFixed(2)}`)}
              {stat("Max loss", strat.maxLoss == null ? "∞" : `$${strat.maxLoss.toFixed(2)}`)}
              {stat("Break-even", strat.breakevens.length ? strat.breakevens.map((b) => `$${b.toFixed(0)}`).join(" / ") : "—")}
              {stat("Net delta", strat.netDelta.toFixed(2), "per share")}
              {stat("Net theta/day", strat.netTheta.toFixed(3))}
            </div>
            <table className="sr-table">
              <thead><tr><th>Leg</th><th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Strike</th><th style={{ textAlign: "right" }}>Premium</th></tr></thead>
              <tbody>
                {strat.legs.map((l, i) => (
                  <tr key={i}>
                    <td style={{ textTransform: "capitalize", fontWeight: 600, color: l.qty >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }}>{l.qty >= 0 ? "Long" : "Short"} {l.kind}</td>
                    <td style={{ textAlign: "right" }} className="num">{l.qty}</td>
                    <td style={{ textAlign: "right" }} className="num">{l.strike != null ? `$${l.strike.toFixed(2)}` : "—"}</td>
                    <td style={{ textAlign: "right" }} className="num">${l.premium.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="sr-hint">Introduce spot, vol y días válidos para construir la estrategia.</div>
        )}
      </div>
    </div>
  );
}
