"use client";
import { useState } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import type { MacroState, ReverseDCFSnapshot } from "@/lib/types";
import { Sk } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/Pill";

interface Props { data: StockData | null; macro: MacroState | null; loading: boolean; ticker: string; }

export default function StockValuation({ data, macro, loading, ticker }: Props) {
  const metrics = data?.metrics;
  const income = data?.income ?? [];
  const balance = data?.balanceSheet ?? [];
  const rdcf: ReverseDCFSnapshot | null = data?.rdcf ?? null;
  const quote = data?.quote;
  const dcf = data?.dcf;

  const currentPrice = (quote?.price as number) ?? 0;
  const baseRevenue = income.length > 0
    ? (income.slice(0, 4).reduce((s, q) => s + ((q.revenue as number) ?? 0), 0))
    : 0;
  // Derive shares from market cap / price as fallback — avoids wild DCF errors from hardcoded default
  const shares = (metrics?.weightedAverageSharesOutstandingDilutedTTM as number)
    ?? (quote?.marketCap != null && currentPrice > 0 ? Number(quote.marketCap) / currentPrice : null);
  const netDebt = Number(balance[0]?.totalDebt ?? 0) - Number(balance[0]?.cashAndCashEquivalents ?? 0);
  const rfRate = macro?.dgs10 != null ? Number(macro.dgs10) : 4.2;

  const [gr1, setGr1] = useState(12);
  const [gr2, setGr2] = useState(8);
  const [ebitMargin, setEbitMargin] = useState(20);
  const [taxRate, setTaxRate] = useState(21);
  const [wacc, setWacc] = useState(Math.max(7, rfRate + 4));
  const [termGr, setTermGr] = useState(3);
  const [capexPct, setCapexPct] = useState(5);

  function calcDCF(g1: number, g2: number, margin: number, tax: number, discount: number, terminal: number, capex: number) {
    if (!shares || !baseRevenue || discount <= terminal) return null;
    let totalPV = 0;
    let rev = baseRevenue;
    for (let yr = 1; yr <= 10; yr++) {
      const growthRate = yr <= 5 ? g1 / 100 : g2 / 100;
      rev *= (1 + growthRate);
      const ebit = rev * (margin / 100);
      const nopat = ebit * (1 - tax / 100);
      const capexAmt = rev * (capex / 100);
      const fcf = nopat - capexAmt;
      totalPV += fcf / Math.pow(1 + discount / 100, yr);
    }
    const termVal = (rev * (margin / 100) * (1 - tax / 100) * (1 + terminal / 100)) / ((discount - terminal) / 100);
    totalPV += termVal / Math.pow(1 + discount / 100, 10);
    const equity = totalPV - netDebt;
    return Math.max(0, equity / shares);
  }

  const intrinsic = calcDCF(gr1, gr2, ebitMargin, taxRate, wacc, termGr, capexPct);
  const upside = intrinsic != null && currentPrice > 0 ? ((intrinsic - currentPrice) / currentPrice) * 100 : null;
  const intrinsicColor = upside == null ? "var(--sr-text-3)" : upside > 15 ? "var(--sr-pos)" : upside > -10 ? "var(--sr-warn)" : "var(--sr-neg)";

  function SliderRow({ label, value, min, max, step = 1, onChange, suffix = "" }: {
    label: string; value: number; min: number; max: number; step?: number;
    onChange: (v: number) => void; suffix?: string;
  }) {
    return (
      <div style={{ marginBottom: "var(--sr-sp-3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>{label}</span>
          <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: "var(--sr-amber)" }} className="num">{value}{suffix}</span>
        </div>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{ width: "100%", accentColor: "var(--sr-amber)" }}
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-5)" }}>
        {/* DCF Model */}
        <div className="card">
          <div className="section-label">Interactive DCF Model</div>
          {loading ? <Sk w="100%" h={300} /> : (
            <>
              <SliderRow label="Year 1-5 Growth" value={gr1} min={-10} max={50} onChange={setGr1} suffix="%" />
              <SliderRow label="Year 6-10 Growth" value={gr2} min={-5} max={30} onChange={setGr2} suffix="%" />
              <SliderRow label="EBIT Margin" value={ebitMargin} min={0} max={60} onChange={setEbitMargin} suffix="%" />
              <SliderRow label="Tax Rate" value={taxRate} min={10} max={40} onChange={setTaxRate} suffix="%" />
              <SliderRow label="WACC / Discount" value={wacc} min={4} max={20} step={0.5} onChange={setWacc} suffix="%" />
              <SliderRow label="Terminal Growth" value={termGr} min={0} max={6} step={0.5} onChange={setTermGr} suffix="%" />
              <SliderRow label="CapEx % Revenue" value={capexPct} min={0} max={30} onChange={setCapexPct} suffix="%" />
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-2)" }}>
                Risk-free rate from macro_state.dgs10: {rfRate.toFixed(2)}%
              </div>
            </>
          )}
        </div>

        {/* Valuation Result */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-4)" }}>
          <div className="card" style={{ flex: 1 }}>
            <div className="section-label">Intrinsic Value</div>
            {loading ? <Sk w={120} h={64} /> : (
              <div>
                <div style={{ fontSize: "var(--sr-t-hero)", fontWeight: 700, color: intrinsicColor, letterSpacing: "-0.03em" }} className="num">
                  {intrinsic != null ? `$${intrinsic.toFixed(2)}` : "N/A"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", marginTop: 8 }}>
                  <span style={{ fontSize: "var(--sr-t-base)", color: "var(--sr-text-2)" }} className="num">
                    Current: ${currentPrice.toFixed(2)}
                  </span>
                  {upside != null && (
                    <Pill
                      label={`${upside >= 0 ? "+" : ""}${upside.toFixed(1)}%`}
                      color={intrinsicColor}
                    />
                  )}
                </div>
                <div style={{ marginTop: "var(--sr-sp-4)", padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>
                  {upside == null ? "Insufficient data for DCF" :
                   upside > 30 ? "Deep Value — significant margin of safety" :
                   upside > 10 ? "Value Zone — modest upside" :
                   upside > -10 ? "Fair Value — limited upside/downside" :
                   upside > -30 ? "Premium — limited margin of safety" :
                   "Overvalued — significant downside risk"}
                </div>
              </div>
            )}
          </div>

          {/* FMP DCF */}
          {dcf && (
            <div className="card">
              <div className="section-label">FMP Consensus DCF</div>
              <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">
                ${Number(dcf.dcf ?? 0).toFixed(2)}
              </div>
              <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 4 }}>
                Discount: {dcf.dcf != null ? (((Number(dcf.dcf) - currentPrice) / currentPrice) * 100).toFixed(1) : "—"}%
              </div>
            </div>
          )}

          {/* Sensitivity table */}
          <div className="card">
            <div className="section-label">Sensitivity — WACC × Terminal Growth</div>
            <div style={{ overflowX: "auto" }}>
              <table className="sr-table" style={{ fontSize: "var(--sr-t-xs)" }}>
                <thead><tr>
                  <th>WACC\TG</th>
                  {[-1, -0.5, 0, 0.5, 1].map(d => <th key={d} style={{ textAlign: "right" }}>{(termGr + d).toFixed(1)}%</th>)}
                </tr></thead>
                <tbody>
                  {[-2, -1, 0, 1, 2].map(wd => {
                    const waccRow = wacc + wd;
                    return (
                      <tr key={wd}>
                        <td style={{ fontWeight: 600 }}>{waccRow.toFixed(1)}%</td>
                        {[-1, -0.5, 0, 0.5, 1].map(td => {
                          const v = calcDCF(gr1, gr2, ebitMargin, taxRate, waccRow, termGr + td, capexPct);
                          const up = v != null && currentPrice > 0 ? ((v - currentPrice) / currentPrice) * 100 : null;
                          const isBase = wd === 0 && td === 0;
                          return (
                            <td key={td} style={{
                              textAlign: "right",
                              background: isBase ? "color-mix(in srgb, var(--sr-amber) 15%, transparent)" :
                                          up == null ? "transparent" :
                                          up > 10 ? "color-mix(in srgb, var(--sr-pos) 10%, transparent)" :
                                          up < -10 ? "color-mix(in srgb, var(--sr-neg) 10%, transparent)" : "transparent",
                              color: up == null ? "var(--sr-text-3)" : up > 0 ? "var(--sr-pos)" : "var(--sr-neg)",
                              fontWeight: isBase ? 700 : 400,
                            }} className="num">
                              {v != null ? `$${v.toFixed(0)}` : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Reverse DCF — auto-computed */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sr-sp-4)" }}>
          <div>
            <div className="section-label">Reverse DCF — Market Expectations</div>
            <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>
              What revenue CAGR does the current price imply? Auto-computed from FCF margin + WACC.
            </div>
          </div>
          {rdcf && (
            <Pill
              label={rdcf.realityBand === "achievable" ? "Achievable" : rdcf.realityBand === "ambitious" ? "Ambitious" : "Very Aggressive"}
              color={rdcf.realityBand === "achievable" ? "var(--sr-pos)" : rdcf.realityBand === "ambitious" ? "var(--sr-warn)" : "var(--sr-neg)"}
            />
          )}
        </div>
        {loading ? <Sk w="100%" h={100} /> : (
          rdcf ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sr-sp-3)" }}>
              {[
                {
                  label: "Implied CAGR (Y1-5)",
                  val: `${rdcf.impliedGrowthCagr.toFixed(1)}%`,
                  color: rdcf.impliedGrowthCagr > 25 ? "var(--sr-neg)" : rdcf.impliedGrowthCagr > 12 ? "var(--sr-warn)" : "var(--sr-pos)",
                },
                {
                  label: "Conservative Value",
                  val: `$${rdcf.conventionalValue.toFixed(2)}`,
                  color: rdcf.upside > 15 ? "var(--sr-pos)" : rdcf.upside > -10 ? "var(--sr-warn)" : "var(--sr-neg)",
                },
                {
                  label: "Upside vs Conservative",
                  val: `${rdcf.upside >= 0 ? "+" : ""}${rdcf.upside.toFixed(1)}%`,
                  color: rdcf.upside > 15 ? "var(--sr-pos)" : rdcf.upside > -10 ? "var(--sr-warn)" : "var(--sr-neg)",
                },
                {
                  label: "Terminal Value Share",
                  val: `${(rdcf.tvShare * 100).toFixed(0)}%`,
                  color: rdcf.tvShare > 0.7 ? "var(--sr-neg)" : "var(--sr-text-2)",
                },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
                  <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color }} className="num">{val}</div>
                </div>
              ))}
              <div style={{ gridColumn: "1 / -1", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-2)" }}>
                WACC {rdcf.wacc.toFixed(1)}% · rf {rdcf.rfRate.toFixed(2)}% · Conservative model: 8% Y1-5, 4% Y6-10
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sr-sp-3)" }}>
              {[
                { label: "Current Price", val: `$${currentPrice.toFixed(2)}` },
                { label: "Risk-Free Rate", val: `${rfRate.toFixed(2)}%` },
                { label: "Status", val: "Insufficient data" },
              ].map(({ label, val }) => (
                <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
                  <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num">{val}</div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── TAX-AWARE P&L ─────────────────────────────────────────── */}
      <TaxAwarePnL price={currentPrice} />
    </div>
  );
}

function TaxAwarePnL({ price }: { price: number }) {
  const [costBasis, setCostBasis] = useState(0);
  const [shares, setShares] = useState(100);
  const [buyDate, setBuyDate] = useState("");

  const gain = costBasis > 0 ? (price - costBasis) * shares : null;
  const gainPct = costBasis > 0 ? ((price - costBasis) / costBasis) * 100 : null;

  const holdingDays = buyDate
    ? Math.floor((Date.now() - new Date(buyDate).getTime()) / 86400000)
    : null;
  const isLTCG = holdingDays != null && holdingDays >= 365;

  const stRate = 0.37;  // top marginal short-term rate
  const ltRate = 0.238; // 20% + 3.8% NIIT
  const taxRate = isLTCG ? ltRate : stRate;
  const taxEstimate = gain != null && gain > 0 ? gain * taxRate : null;
  const netGain = gain != null && taxEstimate != null ? gain - taxEstimate : gain;

  return (
    <div className="card" style={{ marginTop: "var(--sr-sp-5)" }}>
      <div className="section-label">Tax-Aware P&amp;L</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sr-sp-4)", marginBottom: "var(--sr-sp-4)" }}>
        <div>
          <label style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", display: "block", marginBottom: 6 }}>Cost Basis (per share)</label>
          <input
            type="number" min={0} step={0.01} value={costBasis || ""}
            onChange={e => setCostBasis(Number(e.target.value))}
            placeholder="e.g. 150.00"
            style={{ width: "100%", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)", color: "var(--sr-text)", fontSize: "var(--sr-t-sm)", padding: "6px 10px", fontFamily: "inherit" }}
          />
        </div>
        <div>
          <label style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", display: "block", marginBottom: 6 }}>Shares</label>
          <input
            type="number" min={1} step={1} value={shares}
            onChange={e => setShares(Number(e.target.value))}
            style={{ width: "100%", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)", color: "var(--sr-text)", fontSize: "var(--sr-t-sm)", padding: "6px 10px", fontFamily: "inherit" }}
          />
        </div>
        <div>
          <label style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", display: "block", marginBottom: 6 }}>Buy Date</label>
          <input
            type="date" value={buyDate}
            onChange={e => setBuyDate(e.target.value)}
            style={{ width: "100%", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)", color: "var(--sr-text)", fontSize: "var(--sr-t-sm)", padding: "6px 10px", fontFamily: "inherit", colorScheme: "dark" }}
          />
        </div>
      </div>

      {costBasis > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sr-sp-3)" }}>
          <div style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>Unrealized P&amp;L</div>
            <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: gain != null && gain >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
              {gain != null ? `${gain >= 0 ? "+" : ""}$${Math.abs(gain).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
            </div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }} className="num">
              {gainPct != null ? `${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}%` : ""}
            </div>
          </div>

          <div style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>Tax Treatment</div>
            <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: isLTCG ? "var(--sr-pos)" : "var(--sr-warn)" }}>
              {holdingDays == null ? "Enter date" : isLTCG ? "LTCG" : "Short-Term"}
            </div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>
              {holdingDays != null ? `${holdingDays}d held · ${isLTCG ? `${(ltRate * 100).toFixed(1)}%` : `${(stRate * 100).toFixed(0)}%`} rate` : ""}
            </div>
          </div>

          <div style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>Est. Tax Owed</div>
            <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: "var(--sr-neg)" }} className="num">
              {taxEstimate != null ? `$${taxEstimate.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : gain != null && gain <= 0 ? "$0" : "—"}
            </div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>US top marginal rate</div>
          </div>

          <div style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>Net After Tax</div>
            <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: netGain != null && netGain >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
              {netGain != null ? `${netGain >= 0 ? "+" : ""}$${Math.abs(netGain).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
            </div>
            {!isLTCG && holdingDays != null && gain != null && gain > 0 && (
              <div style={{ fontSize: "10px", color: "var(--sr-warn)", marginTop: 2 }}>
                Wait {365 - holdingDays}d → save ${((gain * (stRate - ltRate)).toLocaleString("en-US", { maximumFractionDigits: 0 }))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
