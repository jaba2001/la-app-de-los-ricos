"use client";
import { useState, useEffect, useMemo } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import type { MacroState, ReverseDCFSnapshot } from "@/lib/types";
import { computeWACC, ERP_BASE } from "@/lib/reverseDcf";
import { Sk } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/Pill";

interface Props { data: StockData | null; macro: MacroState | null; loading: boolean; ticker: string; }

// Margin of Safety — Graham threshold: 30%+ vs intrinsic
function getMoS(intrinsic: number | null, price: number): { pct: number; label: string; color: string } | null {
  if (intrinsic == null || intrinsic <= 0 || price <= 0) return null;
  const mos = ((intrinsic - price) / intrinsic) * 100;
  const label = mos >= 30 ? "Graham MoS ✓" : mos >= 15 ? "Moderate MoS" : mos >= 0 ? "Thin MoS" : "No MoS";
  const color = mos >= 30 ? "var(--sr-pos)" : mos >= 15 ? "var(--sr-warn)" : mos >= 0 ? "var(--sr-text-2)" : "var(--sr-neg)";
  return { pct: mos, label, color };
}

// TV Risk bucket
function tvRiskLabel(tvShare: number): { label: string; color: string; warning: string } {
  if (tvShare >= 0.85) return { label: "Speculative", color: "var(--sr-neg)", warning: "85%+ of value from terminal — small g/WACC change has outsized impact" };
  if (tvShare >= 0.70) return { label: "Elevated", color: "var(--sr-warn)", warning: "70%+ terminal dependency — model is sensitive to long-run assumptions" };
  if (tvShare >= 0.50) return { label: "Moderate", color: "var(--sr-text-2)", warning: "Typical for growth companies — monitor terminal assumptions" };
  return { label: "Conservative", color: "var(--sr-pos)", warning: "Well-anchored — majority of value in explicit forecast period" };
}

interface DCFScenario { gr1: number; gr2: number; fcfMargin: number; wacc: number; termGr: number; }
type ScenarioKey = "bear" | "base" | "bull";

interface YearRow { yr: number; revenue: number; fcf: number; pv: number; }
interface DCFOutput {
  perShare: number;
  ev: number;
  equity: number;
  pvOperating: number;
  pvTerminal: number;
  tvShare: number;
  years: YearRow[];
}

function runDCFModel(rev0: number, shares: number | null, netDebt: number, p: DCFScenario): DCFOutput | null {
  if (!shares || shares <= 0 || rev0 <= 0 || p.wacc <= p.termGr) return null;
  let rev = rev0;
  let pvOperating = 0;
  let lastFCF = 0;
  const years: YearRow[] = [];
  for (let yr = 1; yr <= 10; yr++) {
    const g = yr <= 5 ? p.gr1 / 100 : p.gr2 / 100;
    rev *= (1 + g);
    const fcf = rev * (p.fcfMargin / 100);
    const pv = fcf / Math.pow(1 + p.wacc / 100, yr);
    pvOperating += pv;
    years.push({ yr, revenue: rev, fcf, pv });
    if (yr === 10) lastFCF = fcf;
  }
  const tv = (lastFCF * (1 + p.termGr / 100)) / ((p.wacc - p.termGr) / 100);
  const pvTerminal = tv / Math.pow(1 + p.wacc / 100, 10);
  const ev = pvOperating + pvTerminal;
  const equity = ev - netDebt;
  const perShare = Math.max(0, equity / shares);
  const tvShare = ev > 0 ? pvTerminal / ev : 0;
  return { perShare, ev, equity, pvOperating, pvTerminal, tvShare, years };
}

export default function StockValuation({ data, macro, loading, ticker }: Props) {
  const metrics = data?.metrics;
  const income = data?.income ?? [];
  const cashFlow = data?.cashFlow ?? [];
  const balance = data?.balanceSheet ?? [];
  const rdcf: ReverseDCFSnapshot | null = data?.rdcf ?? null;
  const quote = data?.quote;
  const dcf = data?.dcf;

  const currentPrice = (quote?.price as number) ?? 0;
  const baseRevenue = income.length > 0
    ? (income.slice(0, 4).reduce((s, q) => s + ((q.revenue as number) ?? 0), 0))
    : 0;
  const priorRevenue = income.length >= 8
    ? (income.slice(4, 8).reduce((s, q) => s + ((q.revenue as number) ?? 0), 0))
    : 0;
  // Derive shares from market cap / price as fallback — avoids wild DCF errors from hardcoded default
  const shares = (metrics?.weightedAverageSharesOutstandingDilutedTTM as number)
    ?? (quote?.marketCap != null && currentPrice > 0 ? Number(quote.marketCap) / currentPrice : null);
  const netDebt = Number(balance[0]?.totalDebt ?? 0) - Number(balance[0]?.cashAndCashEquivalents ?? 0);
  const rfRate = macro?.dgs10 != null ? Number(macro.dgs10) : 4.2;
  const beta = data?.technicals?.beta ?? (metrics?.beta as number | undefined) ?? 1.0;
  const autoWacc = computeWACC(rfRate, beta, macro?.credit_stress ?? null);

  // TTM FCF margin = (OCF - CapEx) / Revenue, same convention as Reverse DCF for internal consistency
  const ttmFcf = cashFlow.length > 0
    ? cashFlow.slice(0, 4).reduce((s, q) => s + ((Number(q.operatingCashFlow) || 0) + (Number(q.capitalExpenditure) || 0)), 0)
    : 0;
  const ttmFcfMargin = baseRevenue > 0 ? (ttmFcf / baseRevenue) * 100 : 15;
  const ttmGrowth = priorRevenue > 0 ? ((baseRevenue / priorRevenue) - 1) * 100 : 10;

  const defaultScenarios = useMemo<Record<ScenarioKey, DCFScenario>>(() => ({
    bear: {
      gr1: Math.max(-10, Math.min(40, ttmGrowth * 0.4)),
      gr2: Math.max(0, Math.min(20, ttmGrowth * 0.2)),
      fcfMargin: Math.max(1, ttmFcfMargin * 0.75),
      wacc: Math.min(20, autoWacc + 2),
      termGr: 2,
    },
    base: {
      gr1: Math.max(-5, Math.min(50, ttmGrowth)),
      gr2: Math.max(0, Math.min(25, ttmGrowth * 0.5)),
      fcfMargin: Math.max(1, ttmFcfMargin),
      wacc: autoWacc,
      termGr: 2.5,
    },
    bull: {
      gr1: Math.max(0, Math.min(60, ttmGrowth * 1.4)),
      gr2: Math.max(2, Math.min(30, ttmGrowth * 0.7)),
      fcfMargin: Math.max(2, ttmFcfMargin * 1.15),
      wacc: Math.max(7, autoWacc - 1.5),
      termGr: 3,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ticker, Math.round(ttmGrowth), Math.round(ttmFcfMargin), Math.round(autoWacc * 10)]);

  const [scenarios, setScenarios] = useState<Record<ScenarioKey, DCFScenario> | null>(null);
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>("base");
  const [showYearly, setShowYearly] = useState(false);

  // Seed scenarios from real company data whenever the ticker (or its underlying data) changes
  useEffect(() => {
    setScenarios(defaultScenarios);
    setActiveScenario("base");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultScenarios]);

  const active: DCFScenario = scenarios?.[activeScenario] ?? defaultScenarios.base;

  function updateActive(patch: Partial<DCFScenario>) {
    setScenarios(prev => {
      const base = prev ?? defaultScenarios;
      return { ...base, [activeScenario]: { ...base[activeScenario], ...patch } };
    });
  }

  function resetActiveToAuto() {
    setScenarios(prev => ({ ...(prev ?? defaultScenarios), [activeScenario]: defaultScenarios[activeScenario] }));
  }

  const result = runDCFModel(baseRevenue, shares, netDebt, active);
  const intrinsic = result?.perShare ?? null;
  const upside = intrinsic != null && currentPrice > 0 ? ((intrinsic - currentPrice) / currentPrice) * 100 : null;
  const intrinsicColor = upside == null ? "var(--sr-text-3)" : upside > 15 ? "var(--sr-pos)" : upside > -10 ? "var(--sr-warn)" : "var(--sr-neg)";
  const mos = getMoS(intrinsic, currentPrice);

  // Feature 2: FCF Yield + Feature 1: CapEx/Revenue — derived from raw data already in props
  const fcqual = data?.fcfQuality ?? null;
  const fcfYieldPct = fcqual?.fcfYield != null ? fcqual.fcfYield * 100 : null;
  const capexRev   = fcqual?.capexToRevenue != null ? fcqual.capexToRevenue * 100 : null;
  const fcfGrowPct = fcqual?.fcfGrowthYoy ?? null;
  const fcfYieldColor = fcfYieldPct == null ? "var(--sr-text-3)" : fcfYieldPct > 8 ? "var(--sr-pos)" : fcfYieldPct > 4 ? "var(--sr-text-2)" : fcfYieldPct > 0 ? "var(--sr-text-3)" : "var(--sr-neg)";
  const capexColor   = capexRev == null ? "var(--sr-text-3)" : capexRev < 5 ? "var(--sr-pos)" : capexRev < 15 ? "var(--sr-text-2)" : capexRev > 35 ? "var(--sr-neg)" : "var(--sr-text-3)";
  const fcfGrowColor = fcfGrowPct == null ? "var(--sr-text-3)" : fcfGrowPct > 20 ? "var(--sr-pos)" : fcfGrowPct > 0 ? "var(--sr-text-2)" : "var(--sr-neg)";

  // All-scenario comparison (for the synthesis bar)
  const allScenarios: { key: ScenarioKey; label: string; color: string }[] = [
    { key: "bear", label: "Bear", color: "var(--sr-neg)" },
    { key: "base", label: "Base", color: "var(--sr-amber)" },
    { key: "bull", label: "Bull", color: "var(--sr-pos)" },
  ];
  const scenarioValues = scenarios
    ? allScenarios.map(s => ({ ...s, value: runDCFModel(baseRevenue, shares, netDebt, scenarios[s.key])?.perShare ?? null }))
    : [];

  // Sensitivity table now keys off the active scenario's growth/margin, varying WACC × terminal growth
  function calcDCF(g1: number, g2: number, fcfMargin: number, discount: number, terminal: number): number | null {
    return runDCFModel(baseRevenue, shares, netDebt, { gr1: g1, gr2: g2, fcfMargin, wacc: discount, termGr: terminal })?.perShare ?? null;
  }

  // Feature 5: Growth × Exit Multiple (P/FCF) sensitivity — simpler Trainor/multiple-based cross-check
  // Compute FCF at Y10 for a given growth path, then apply a P/FCF exit multiple discounted back
  function calcMultipleSensitivity(growthPct: number, exitMultiple: number): number | null {
    if (!shares || shares <= 0 || baseRevenue <= 0 || active.wacc <= 0) return null;
    let rev = baseRevenue;
    let lastFCF = 0;
    for (let yr = 1; yr <= 10; yr++) {
      const g = yr <= 5 ? growthPct / 100 : (growthPct / 2) / 100;
      rev *= (1 + g);
      lastFCF = rev * (active.fcfMargin / 100);
    }
    // Exit value = FCF₁₀ × multiple, discounted back 10 years + PV of FCF Y1-9
    let pvFCFs = 0;
    let rev2 = baseRevenue;
    for (let yr = 1; yr <= 9; yr++) {
      const g = yr <= 5 ? growthPct / 100 : (growthPct / 2) / 100;
      rev2 *= (1 + g);
      pvFCFs += (rev2 * (active.fcfMargin / 100)) / Math.pow(1 + active.wacc / 100, yr);
    }
    const exitPV = (lastFCF * exitMultiple) / Math.pow(1 + active.wacc / 100, 10);
    const equity = pvFCFs + exitPV - netDebt;
    return Math.max(0, equity / shares);
  }
  const growthRows = scenarios
    ? [scenarios.bear.gr1, scenarios.base.gr1, scenarios.bull.gr1]
    : [defaultScenarios.bear.gr1, defaultScenarios.base.gr1, defaultScenarios.bull.gr1];
  const exitMultiples = [12, 18, 25, 35];

  function SliderRow({ label, value, min, max, step = 1, onChange, suffix = "" }: {
    label: string; value: number; min: number; max: number; step?: number;
    onChange: (v: number) => void; suffix?: string;
  }) {
    return (
      <div style={{ marginBottom: "var(--sr-sp-3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>{label}</span>
          <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: "var(--sr-amber)" }} className="num">{value.toFixed(step < 1 ? 1 : 0)}{suffix}</span>
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
      {/* Scenario tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-4)" }}>
        {allScenarios.map(s => (
          <button
            key={s.key}
            className={`subtab ${activeScenario === s.key ? "active" : ""}`}
            onClick={() => setActiveScenario(s.key)}
            style={activeScenario === s.key ? { borderColor: s.color, color: s.color } : undefined}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={resetActiveToAuto}
          style={{ marginLeft: "auto", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
        >
          Reset to auto
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-5)" }}>
        {/* DCF Model */}
        <div className="card">
          <div className="section-label">
            Interactive DCF Model — {allScenarios.find(s => s.key === activeScenario)?.label}
          </div>
          {loading ? <Sk w="100%" h={300} /> : (
            <>
              <SliderRow label="Year 1-5 Growth" value={active.gr1} min={-10} max={60} onChange={v => updateActive({ gr1: v })} suffix="%" />
              <SliderRow label="Year 6-10 Growth" value={active.gr2} min={-5} max={30} onChange={v => updateActive({ gr2: v })} suffix="%" />
              <SliderRow label="FCF Margin" value={active.fcfMargin} min={0} max={50} onChange={v => updateActive({ fcfMargin: v })} suffix="%" />
              <SliderRow label="WACC / Discount" value={active.wacc} min={4} max={20} step={0.5} onChange={v => updateActive({ wacc: v })} suffix="%" />
              <SliderRow label="Terminal Growth" value={active.termGr} min={0} max={6} step={0.5} onChange={v => updateActive({ termGr: v })} suffix="%" />
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-2)", lineHeight: 1.5 }}>
                FCF margin model — same methodology as Reverse DCF. WACC auto-seeded from rf {rfRate.toFixed(2)}% + β {beta.toFixed(2)} × ERP {ERP_BASE.toFixed(1)}%{macro?.credit_stress != null ? ` (+ credit stress)` : ""}.
                TTM revenue growth {ttmGrowth.toFixed(1)}%, TTM FCF margin {ttmFcfMargin.toFixed(1)}%.
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
                  {mos != null && (
                    <Pill label={mos.label} color={mos.color} />
                  )}
                </div>
                {mos != null && (
                  <div style={{ marginTop: "var(--sr-sp-2)", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
                    Graham Margin of Safety: <span style={{ color: mos.color, fontWeight: 700 }} className="num">{mos.pct.toFixed(1)}%</span>
                    {mos.pct >= 30 ? " — meets Graham's 30% threshold" : mos.pct >= 0 ? " — below Graham's 30% threshold" : " — price exceeds intrinsic estimate"}
                  </div>
                )}
                <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>
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

          {/* Scenario synthesis */}
          {scenarioValues.length > 0 && (
            <div className="card">
              <div className="section-label">Scenario Synthesis</div>
              <div style={{ display: "grid", gridTemplateColumns: dcf ? "repeat(4, 1fr)" : "repeat(3, 1fr)", gap: "var(--sr-sp-3)" }}>
                {scenarioValues.map(s => (
                  <div key={s.key} style={{
                    background: s.key === activeScenario ? `color-mix(in srgb, ${s.color} 10%, var(--sr-surface-2))` : "var(--sr-surface-2)",
                    borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)",
                    border: s.key === activeScenario ? `1px solid color-mix(in srgb, ${s.color} 40%, transparent)` : "1px solid transparent",
                  }}>
                    <div style={{ fontSize: "var(--sr-t-xs)", color: s.color, marginBottom: 4, fontWeight: 600 }}>{s.label}</div>
                    <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700 }} className="num">
                      {s.value != null ? `$${s.value.toFixed(2)}` : "—"}
                    </div>
                  </div>
                ))}
                {dcf && (
                  <div className="sr-tile">
                    <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4, fontWeight: 600 }}>FMP</div>
                    <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700 }} className="num">
                      ${Number(dcf.dcf ?? 0).toFixed(2)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* EV Bridge */}
          {result && (
            <div className="card">
              <div className="section-label">EV Bridge</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  { label: "PV Operating FCF (Y1-10)", val: result.pvOperating },
                  { label: "+ PV Terminal Value", val: result.pvTerminal },
                  { label: "= Enterprise Value", val: result.ev, bold: true },
                  { label: netDebt >= 0 ? "− Net Debt" : "+ Net Cash", val: -netDebt },
                  { label: "= Equity Value", val: result.equity, bold: true },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--sr-t-sm)", fontWeight: row.bold ? 700 : 400, color: row.bold ? "var(--sr-text)" : "var(--sr-text-2)" }}>
                    <span>{row.label}</span>
                    <span className="num">${(row.val / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}M</span>
                  </div>
                ))}
                {(() => {
                  const tvr = tvRiskLabel(result.tvShare);
                  return (
                    <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: result.tvShare >= 0.70 ? `color-mix(in srgb, ${tvr.color} 8%, var(--sr-surface-2))` : "var(--sr-surface-2)", border: `1px solid ${result.tvShare >= 0.70 ? `color-mix(in srgb, ${tvr.color} 30%, transparent)` : "transparent"}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-2)", marginBottom: 4 }}>
                        <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: tvr.color }}>TV Risk: {tvr.label}</span>
                        <span className="sr-hint">({(result.tvShare * 100).toFixed(0)}% of EV)</span>
                      </div>
                      <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", lineHeight: 1.4 }}>{tvr.warning}</div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* FMP DCF */}
          {dcf && (
            <div className="card">
              <div className="section-label">FMP Consensus DCF</div>
              <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">
                ${Number(dcf.dcf ?? 0).toFixed(2)}
              </div>
              <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 4 }}>
                Upside to fair value: {dcf.dcf != null ? `${Number(dcf.dcf) >= currentPrice ? "+" : ""}${(((Number(dcf.dcf) - currentPrice) / currentPrice) * 100).toFixed(1)}%` : "—"}
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
                  {[-1, -0.5, 0, 0.5, 1].map(d => <th key={d} style={{ textAlign: "right" }}>{(active.termGr + d).toFixed(1)}%</th>)}
                </tr></thead>
                <tbody>
                  {[-2, -1, 0, 1, 2].map(wd => {
                    const waccRow = active.wacc + wd;
                    return (
                      <tr key={wd}>
                        <td style={{ fontWeight: 600 }}>{waccRow.toFixed(1)}%</td>
                        {[-1, -0.5, 0, 0.5, 1].map(td => {
                          const v = calcDCF(active.gr1, active.gr2, active.fcfMargin, waccRow, active.termGr + td);
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

      {/* Year-by-year projection */}
      {result && (
        <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
          <div
            className="section-label"
            style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            onClick={() => setShowYearly(v => !v)}
          >
            <span>10-Year Projection</span>
            <span className="sr-hint">{showYearly ? "Hide ▲" : "Show ▼"}</span>
          </div>
          {showYearly && (
            <div style={{ overflowX: "auto", marginTop: "var(--sr-sp-3)" }}>
              <table className="sr-table" style={{ fontSize: "var(--sr-t-xs)" }}>
                <thead><tr>
                  <th>Year</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                  <th style={{ textAlign: "right" }}>FCF</th>
                  <th style={{ textAlign: "right" }}>PV of FCF</th>
                </tr></thead>
                <tbody>
                  {result.years.map(y => (
                    <tr key={y.yr}>
                      <td>Y{y.yr}</td>
                      <td style={{ textAlign: "right" }} className="num">${(y.revenue / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}M</td>
                      <td style={{ textAlign: "right" }} className="num">${(y.fcf / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}M</td>
                      <td style={{ textAlign: "right", color: "var(--sr-text-2)" }} className="num">${(y.pv / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}M</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Feature 1+2: FCF Quality Panel */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="section-label">FCF Quality</div>
        {loading ? <Sk w="100%" h={80} /> : (
          <div className="sr-grid-4">
            {[
              {
                label: "FCF Yield",
                val: fcfYieldPct != null ? `${fcfYieldPct.toFixed(1)}%` : "—",
                color: fcfYieldColor,
                sub: fcfYieldPct != null ? (fcfYieldPct > 8 ? "High quality" : fcfYieldPct > 4 ? "Moderate" : fcfYieldPct > 0 ? "Low yield" : "Negative FCF") : "No data",
                hint: "FCF TTM / Market Cap — higher = more attractive than P/E suggests",
              },
              {
                label: "CapEx/Revenue",
                val: capexRev != null ? `${capexRev.toFixed(1)}%` : "—",
                color: capexColor,
                sub: capexRev != null ? (capexRev < 5 ? "Asset-light ★" : capexRev < 15 ? "Moderate" : capexRev < 30 ? "Capital-heavy" : "Very CapEx-intensive") : "No data",
                hint: "Lower = more FCF per $ of revenue (Uber/Airbnb model)",
              },
              {
                label: "FCF Growth YoY",
                val: fcfGrowPct != null ? (Math.abs(fcfGrowPct) > 300 ? "n/m" : `${fcfGrowPct >= 0 ? "+" : ""}${fcfGrowPct.toFixed(0)}%`) : "—",
                color: fcfGrowColor,
                sub: fcfGrowPct != null ? (Math.abs(fcfGrowPct) > 300 ? "Base near zero" : fcfGrowPct > 20 ? "Strong" : fcfGrowPct > 0 ? "Positive" : "Declining") : "No data",
                hint: "TTM FCF vs prior 4Q — confirms or refutes earnings quality",
              },
              {
                label: "FCF vs Earnings",
                val: (() => {
                  const epsGr = data?.ratios?.netIncomeGrowthTTM != null ? Number(data.ratios.netIncomeGrowthTTM) * 100 : null;
                  if (fcfGrowPct == null || fcqual?.fcfGrowthYoy == null || epsGr == null) return "—";
                  const div = fcqual.fcfGrowthYoy - epsGr;
                  return Math.abs(div) > 300 ? "n/m" : `${div >= 0 ? "+" : ""}${div.toFixed(0)}pp`;
                })(),
                color: (() => {
                  const epsGr = data?.ratios?.netIncomeGrowthTTM != null ? Number(data.ratios.netIncomeGrowthTTM) * 100 : null;
                  if (fcfGrowPct == null || epsGr == null) return "var(--sr-text-3)";
                  const div = fcfGrowPct - epsGr;
                  return div > 10 ? "var(--sr-pos)" : div < -15 ? "var(--sr-neg)" : "var(--sr-text-2)";
                })(),
                sub: (() => {
                  const epsGr = data?.ratios?.netIncomeGrowthTTM != null ? Number(data.ratios.netIncomeGrowthTTM) * 100 : null;
                  if (fcfGrowPct == null || epsGr == null) return "No data";
                  const div = fcfGrowPct - epsGr;
                  return div > 10 ? "FCF outpacing ✓" : div < -15 ? "Earnings ahead ⚠" : "Aligned";
                })(),
                hint: "FCF growth minus EPS growth — positive = cash generation outpaces accounting earnings",
              },
            ].map(({ label, val, color, sub, hint }) => (
              <div key={label} className="sr-tile" title={hint}>
                <div className="sr-tile-label">{label}</div>
                <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color }} className="num">{val}</div>
                <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 3 }}>{sub}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Feature 5: Growth × Exit Multiple sensitivity */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="section-label">Sensitivity — Revenue Growth × Exit P/FCF Multiple</div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)" }}>
          Implied price using bear/base/bull growth paths × 4 P/FCF exit multiples at year 10. Uses active FCF margin ({active.fcfMargin.toFixed(0)}%) and WACC ({active.wacc.toFixed(1)}%).
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="sr-table" style={{ fontSize: "var(--sr-t-xs)" }}>
            <thead><tr>
              <th>Growth→</th>
              {growthRows.map((g, i) => <th key={i} style={{ textAlign: "right" }}>{["Bear", "Base", "Bull"][i]} ({g.toFixed(0)}%)</th>)}
            </tr></thead>
            <tbody>
              {exitMultiples.map(em => (
                <tr key={em}>
                  <td style={{ fontWeight: 600 }}>{em}× P/FCF</td>
                  {growthRows.map((g, gi) => {
                    const v = calcMultipleSensitivity(g, em);
                    const up = v != null && currentPrice > 0 ? ((v - currentPrice) / currentPrice) * 100 : null;
                    const isBase = gi === 1 && em === exitMultiples[1];
                    return (
                      <td key={gi} style={{
                        textAlign: "right",
                        background: isBase ? "color-mix(in srgb, var(--sr-amber) 15%, transparent)" :
                                    up == null ? "transparent" :
                                    up > 10 ? "color-mix(in srgb, var(--sr-pos) 10%, transparent)" :
                                    up < -10 ? "color-mix(in srgb, var(--sr-neg) 10%, transparent)" : "transparent",
                        color: up == null ? "var(--sr-text-3)" : up > 0 ? "var(--sr-pos)" : "var(--sr-neg)",
                        fontWeight: isBase ? 700 : 400,
                      }} className="num">
                        {v != null ? `$${v.toFixed(0)}` : "—"}
                        {up != null ? <span style={{ fontSize: "9px", marginLeft: 3 }}>({up >= 0 ? "+" : ""}{up.toFixed(0)}%)</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reverse DCF — auto-computed */}
      <div className="card">
        <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-4)" }}>
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
            <div className="sr-grid-4">
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
                  color: tvRiskLabel(rdcf.tvShare).color,
                },
              ].map(({ label, val, color }) => (
                <div key={label} className="sr-tile">
                  <div className="sr-tile-label">{label}</div>
                  <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color }} className="num">{val}</div>
                </div>
              ))}
              <div style={{ gridColumn: "1 / -1", marginTop: "var(--sr-sp-2)" }}>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-2)" }}>
                  WACC {rdcf.wacc.toFixed(1)}% · rf {rdcf.rfRate.toFixed(2)}% · Conservative model: 8% Y1-5, 4% Y6-10
                </div>
                {(() => {
                  const tvr = tvRiskLabel(rdcf.tvShare);
                  return rdcf.tvShare >= 0.50 ? (
                    <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${tvr.color} 8%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${tvr.color} 25%, transparent)`, fontSize: "var(--sr-t-xs)", color: tvr.color }}>
                      ▸ Terminal Value Risk ({tvr.label}): {tvr.warning}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
          ) : (
            <div className="sr-grid-3">
              {[
                { label: "Current Price", val: `$${currentPrice.toFixed(2)}` },
                { label: "Risk-Free Rate", val: `${rfRate.toFixed(2)}%` },
                { label: "Status", val: "Insufficient data" },
              ].map(({ label, val }) => (
                <div key={label} className="sr-tile">
                  <div className="sr-tile-label">{label}</div>
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
  // LTCG requires holding MORE than one year (IRC §1222) — exactly 365 days is still short-term
  const isLTCG = holdingDays != null && holdingDays > 365;

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
        <div className="sr-grid-4">
          <div className="sr-tile">
            <div className="sr-tile-label">Unrealized P&amp;L</div>
            <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: gain != null && gain >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
              {gain != null ? `${gain >= 0 ? "+" : ""}$${Math.abs(gain).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
            </div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }} className="num">
              {gainPct != null ? `${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}%` : ""}
            </div>
          </div>

          <div className="sr-tile">
            <div className="sr-tile-label">Tax Treatment</div>
            <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: isLTCG ? "var(--sr-pos)" : "var(--sr-warn)" }}>
              {holdingDays == null ? "Enter date" : isLTCG ? "LTCG" : "Short-Term"}
            </div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>
              {holdingDays != null ? `${holdingDays}d held · ${isLTCG ? `${(ltRate * 100).toFixed(1)}%` : `${(stRate * 100).toFixed(0)}%`} rate` : ""}
            </div>
          </div>

          <div className="sr-tile">
            <div className="sr-tile-label">Est. Tax Owed</div>
            <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: "var(--sr-neg)" }} className="num">
              {taxEstimate != null ? `$${taxEstimate.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : gain != null && gain <= 0 ? "$0" : "—"}
            </div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>US top marginal rate</div>
          </div>

          <div className="sr-tile">
            <div className="sr-tile-label">Net After Tax</div>
            <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: netGain != null && netGain >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
              {netGain != null ? `${netGain >= 0 ? "+" : ""}$${Math.abs(netGain).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
            </div>
            {!isLTCG && holdingDays != null && gain != null && gain > 0 && (
              <div style={{ fontSize: "10px", color: "var(--sr-warn)", marginTop: 2 }}>
                Wait {366 - holdingDays}d → save ${((gain * (stRate - ltRate)).toLocaleString("en-US", { maximumFractionDigits: 0 }))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
