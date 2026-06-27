"use client";
import { useState, useMemo } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import { Sk } from "@/components/ui/Skeleton";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Cell, BarChart, LineChart,
  Brush,
} from "recharts";
import {
  computeSqueeze, computeADX, computeVolumeProfile, computeTLResult, detectDivergences,
  type OHLCV,
} from "@/lib/technicalIndicators";

interface Props {
  data: StockData | null; loading: boolean; ticker: string;
  icScore?: number | null;
  dgs2?: number | null;
}

type Period = "1M" | "3M" | "6M" | "1Y" | "5Y";

const fmtVol = (v: number) =>
  v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : `${v}`;

const PERIOD_DAYS: Record<Period, number> = { "1M": 22, "3M": 65, "6M": 130, "1Y": 252, "5Y": 1260 };

function emaOf(arr: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = arr[0] ?? 0;
  for (const v of arr) { const e = v * k + prev * (1 - k); out.push(e); prev = e; }
  return out;
}

const CHART_MARGIN = { top: 5, right: 10, left: 0, bottom: 5 };
const AXIS_STYLE   = { fill: "var(--sr-text-3)", fontSize: 10 };

function ToggleBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 10px", borderRadius: "var(--sr-radius-pill)", fontSize: "var(--sr-t-xs)",
      fontWeight: 600, border: "1px solid var(--sr-border)", cursor: "pointer",
      background: active ? "var(--sr-surface-2)" : "transparent",
      color: active ? "var(--sr-text)" : "var(--sr-text-3)",
    }}>{label}</button>
  );
}

export default function StockChart({ data, loading, ticker, icScore = null, dgs2 = null }: Props) {
  const [period, setPeriod]           = useState<Period>("1Y");
  const [showEMA, setShowEMA]         = useState(true);
  const [showVolume, setShowVolume]   = useState(false);
  const [showSqueeze, setShowSqueeze] = useState(false);
  const [showADX, setShowADX]         = useState(false);
  const [showVP, setShowVP]           = useState(false);
  const [showBrush, setShowBrush]     = useState(false);
  const [showDivergence, setShowDivergence] = useState(false);

  const rawHistory = data?.history ?? [];

  // ─── Compute all indicators on full history, slice to display period ──────
  const { chartData, vp, tlResult, divergences } = useMemo(() => {
    if (!rawHistory.length) return { chartData: [], vp: null, tlResult: null, divergences: [] };

    const fullSorted = [...rawHistory]
      .sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime());

    const fullOHLCV: OHLCV[] = fullSorted.map(d => ({
      open:   Number(d.open    ?? d.close  ?? 0),
      high:   Number(d.high    ?? d.close  ?? 0),
      low:    Number(d.low     ?? d.close  ?? 0),
      close:  Number(d.close   ?? (d as Record<string,unknown>).adjClose ?? 0),
      volume: Number(d.volume  ?? 0),
    }));
    const fullPrices = fullOHLCV.map(d => d.close);

    const allEmaFast = emaOf(fullPrices, 10);  // IC-calibrated: 10/55 matches StockLens
    const allEmaSlow = emaOf(fullPrices, 55);
    const allSqz   = computeSqueeze(fullOHLCV);
    const allADX   = computeADX(fullOHLCV);

    const days       = PERIOD_DAYS[period];
    const sliceStart = Math.max(0, fullSorted.length - days);
    const dispOHLCV  = fullOHLCV.slice(sliceStart);
    const vpResult   = computeVolumeProfile(dispOHLCV);

    const cd = fullSorted.slice(sliceStart).map((d, i) => {
      const ai  = sliceStart + i;
      const sqp = allSqz[ai];
      const adp = allADX[ai];
      return {
        date:     (d.date as string).slice(0, 10),
        price:    fullPrices[ai],
        emaFast:  allEmaFast[ai],
        emaSlow:  allEmaSlow[ai],
        volume:   fullOHLCV[ai].volume,
        high:     fullOHLCV[ai].high,
        low:      fullOHLCV[ai].low,
        sqzVal:   sqp?.val      ?? null,
        sqzOn:    sqp?.sqzOn    ?? false,
        sqzOff:   sqp?.sqzOff   ?? false,
        adxVal:   adp?.adx      ?? null,
        plusDI:   adp?.plusDI   ?? null,
        minusDI:  adp?.minusDI  ?? null,
      };
    });

    const sqSlice  = allSqz.slice(sliceStart);
    const adxSlice = allADX.slice(sliceStart);
    const rawDisp  = cd.map(d => ({ high: d.high, low: d.low, price: d.price, emaFast: d.emaFast, emaSlow: d.emaSlow }));
    const tl = computeTLResult(
      cd.map(d => d.price), cd.map(d => d.emaFast), cd.map(d => d.emaSlow),
      rawDisp, sqSlice, adxSlice, vpResult, icScore,
    );

    // Divergences from squeeze momentum
    const prices = cd.map(d => d.price);
    const sqzMom = sqSlice.map(s => s?.val ?? null);
    const divs = detectDivergences(prices, sqzMom);

    return { chartData: cd, vp: vpResult, tlResult: tl, divergences: divs };
  }, [rawHistory, period, icScore]);

  const quote   = data?.quote;
  const profile = data?.profile;

  const minPrice   = chartData.length ? Math.min(...chartData.map(d => d.price)) * 0.97 : 0;
  const maxPrice   = chartData.length ? Math.max(...chartData.map(d => d.price)) * 1.03 : 100;
  const firstPrice = chartData[0]?.price ?? 0;
  const lastPrice  = chartData[chartData.length - 1]?.price ?? 0;
  const totalReturn = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const returnColor = totalReturn >= 0 ? "var(--sr-pos)" : "var(--sr-neg)";

  const vpChartData = vp
    ? [...vp.buckets].reverse().map(b => ({
        label: `$${b.mid.toFixed(0)}`, vol: b.vol, isPOC: b.isPOC, inVA: b.inVA, mid: b.mid,
      }))
    : [];

  const showSubpanels = showSqueeze || showADX || showVP;

  return (
    <div className="animate-fade-in">
      {/* Header stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-5)" }}>
        {[
          { label: "Current Price",    val: quote?.price    != null ? `$${Number(quote.price).toFixed(2)}`    : "—", color: "var(--sr-text)" },
          { label: `${period} Return`, val: chartData.length > 1 ? `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%` : "—", color: returnColor },
          { label: "52W High",         val: quote?.yearHigh != null ? `$${Number(quote.yearHigh).toFixed(2)}` : "—", color: "var(--sr-text)" },
          { label: "52W Low",          val: quote?.yearLow  != null ? `$${Number(quote.yearLow).toFixed(2)}`  : "—", color: "var(--sr-text)" },
        ].map(({ label, val, color }) => (
          <div key={label} className="card-sm">
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color }} className="num">{val}</div>
          </div>
        ))}
      </div>

      {/* Main chart card */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        {/* Controls */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sr-sp-4)", flexWrap: "wrap", gap: "var(--sr-sp-3)" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {(["1M", "3M", "6M", "1Y", "5Y"] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                padding: "4px 10px", borderRadius: "var(--sr-radius-pill)", fontSize: "var(--sr-t-xs)",
                fontWeight: 600, border: "1px solid transparent", cursor: "pointer",
                background:   period === p ? "var(--sr-amber-dim)" : "transparent",
                color:        period === p ? "var(--sr-amber)"     : "var(--sr-text-3)",
                borderColor:  period === p ? "color-mix(in srgb, var(--sr-amber) 40%, transparent)" : "transparent",
              }}>{p}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "var(--sr-sp-2)", flexWrap: "wrap" }}>
            <ToggleBtn label="EMA 10/55"  active={showEMA}        onClick={() => setShowEMA(!showEMA)} />
            <ToggleBtn label="Volume"      active={showVolume}     onClick={() => setShowVolume(!showVolume)} />
            <ToggleBtn label="VP Levels"   active={showVP}         onClick={() => setShowVP(!showVP)} />
            {dgs2 != null && <ToggleBtn label={`Fed ~${dgs2.toFixed(1)}%`} active={false} onClick={() => {}} />}
            <div style={{ width: 1, background: "var(--sr-border)", margin: "0 2px" }} />
            <ToggleBtn label="Squeeze"     active={showSqueeze}   onClick={() => setShowSqueeze(!showSqueeze)} />
            <ToggleBtn label="ADX"         active={showADX}       onClick={() => setShowADX(!showADX)} />
            <ToggleBtn label="Divergence"  active={showDivergence} onClick={() => setShowDivergence(!showDivergence)} />
            <ToggleBtn label="Zoom Range"  active={showBrush}      onClick={() => setShowBrush(!showBrush)} />
          </div>
        </div>

        {loading || !chartData.length ? (
          <Sk w="100%" h={300} />
        ) : (
          <>
            {/* ── Price chart ───────────────────────────────────────────── */}
            <ResponsiveContainer width="100%" height={showVolume ? 370 : 310}>
              <ComposedChart data={chartData} margin={CHART_MARGIN} syncId="sc">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sr-border)" strokeOpacity={0.5} />
                <XAxis dataKey="date" tick={AXIS_STYLE} tickFormatter={v => v.slice(5)} interval="preserveStartEnd" />
                <YAxis yAxisId="price" domain={[minPrice, maxPrice]} tick={AXIS_STYLE}
                  tickFormatter={v => `$${v.toFixed(0)}`} width={54} />
                {showVolume && (
                  <YAxis yAxisId="vol" orientation="right" tick={AXIS_STYLE} tickFormatter={fmtVol} width={44} />
                )}
                <Tooltip
                  contentStyle={{ background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: 8, fontSize: 11 }}
                  labelStyle={{ color: "var(--sr-text-2)" }}
                  formatter={(v: number, name: string) =>
                    name === "volume" ? [fmtVol(v), "Volume"] : [`$${v.toFixed(2)}`, name]
                  }
                />
                {showVP && vp && (
                  <>
                    <ReferenceArea yAxisId="price" y1={vp.vaLow} y2={vp.vaHigh}
                      fill="color-mix(in srgb, var(--sr-info) 8%, transparent)" />
                    <ReferenceLine yAxisId="price" y={vp.pocMid}
                      stroke="var(--sr-amber)" strokeDasharray="5 3" strokeWidth={1.5}
                      label={{ value: `POC $${vp.pocMid.toFixed(0)}`, position: "insideTopLeft", fill: "var(--sr-amber)", fontSize: 9 }} />
                  </>
                )}
                {showVolume && (
                  <Bar yAxisId="vol" dataKey="volume"
                    fill="color-mix(in srgb, var(--sr-text-3) 20%, transparent)"
                    radius={[1,1,0,0]} maxBarSize={5} isAnimationActive={false} />
                )}
                <Line yAxisId="price" type="monotone" dataKey="price"
                  stroke="var(--sr-amber)" strokeWidth={2} dot={false} isAnimationActive={false} />
                {showEMA && (
                  <>
                    <Line yAxisId="price" type="monotone" dataKey="emaFast" name="EMA 10"
                      stroke="var(--sr-pos)"  strokeWidth={1} dot={false} strokeOpacity={0.75} isAnimationActive={false} />
                    <Line yAxisId="price" type="monotone" dataKey="emaSlow" name="EMA 55"
                      stroke="var(--sr-info)" strokeWidth={1} dot={false} strokeOpacity={0.75} isAnimationActive={false} />
                  </>
                )}
                {quote?.price && (
                  <ReferenceLine yAxisId="price" y={Number(quote.price)}
                    stroke="var(--sr-text-3)" strokeDasharray="4 4" />
                )}
                {/* Divergence markers on main chart */}
                {showDivergence && divergences.map((div, i) => {
                  const date = chartData[div.dateIdx]?.date;
                  if (!date) return null;
                  return (
                    <ReferenceLine key={i} yAxisId="price" x={date}
                      stroke={div.type === "bullish" ? "var(--sr-pos)" : "var(--sr-neg)"}
                      strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.6}
                    />
                  );
                })}
                {showBrush && (
                  <Brush dataKey="date" height={28} stroke="var(--sr-border)"
                    fill="var(--sr-surface-2)" travellerWidth={8} />
                )}
              </ComposedChart>
            </ResponsiveContainer>

            {/* ── Squeeze subpanel ──────────────────────────────────────── */}
            {showSqueeze && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0 2px", borderTop: "1px solid var(--sr-border)" }}>
                  <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", fontWeight: 700, width: 54 }}>SQUEEZE</span>
                  <span style={{ fontSize: "10px", color: "var(--sr-pos)"  }}>▬ Pos momentum</span>
                  <span style={{ fontSize: "10px", color: "var(--sr-neg)"  }}>▬ Neg momentum</span>
                  <span style={{ fontSize: "10px", color: "var(--sr-text-3)", opacity: 0.5 }}>dim = squeeze building</span>
                </div>
                <ResponsiveContainer width="100%" height={75}>
                  <BarChart data={chartData} margin={{ top: 2, right: 10, left: 0, bottom: 2 }} syncId="sc">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--sr-border)" strokeOpacity={0.3} vertical={false} />
                    <XAxis dataKey="date" tick={{ ...AXIS_STYLE, fontSize: 9 }} tickFormatter={v => v.slice(5)} interval="preserveStartEnd" height={14} />
                    <YAxis tick={{ ...AXIS_STYLE, fontSize: 9 }} width={54} />
                    <ReferenceLine y={0} stroke="var(--sr-text-3)" strokeOpacity={0.4} />
                    <Bar dataKey="sqzVal" maxBarSize={6} isAnimationActive={false}>
                      {chartData.map((d, i) => (
                        <Cell key={i}
                          fill={(d.sqzVal ?? 0) >= 0 ? "var(--sr-pos)" : "var(--sr-neg)"}
                          fillOpacity={d.sqzOn ? 0.35 : 1.0}
                        />
                      ))}
                    </Bar>
                    {/* Divergence markers */}
                    {showDivergence && divergences.map((div, i) => {
                      const date = chartData[div.dateIdx]?.date;
                      if (!date) return null;
                      return (
                        <ReferenceLine key={i} x={date}
                          stroke={div.type === "bullish" ? "var(--sr-pos)" : "var(--sr-neg)"}
                          strokeWidth={2} strokeDasharray="2 2"
                          label={{ value: div.type === "bullish" ? "↑" : "↓", position: "top", fill: div.type === "bullish" ? "var(--sr-pos)" : "var(--sr-neg)", fontSize: 12 }}
                        />
                      );
                    })}
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}

            {/* ── ADX subpanel ──────────────────────────────────────────── */}
            {showADX && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0 2px", borderTop: "1px solid var(--sr-border)" }}>
                  <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", fontWeight: 700, width: 54 }}>ADX</span>
                  <span style={{ fontSize: "10px", color: "#E2E8F0" }}>— ADX</span>
                  <span style={{ fontSize: "10px", color: "var(--sr-pos)" }}>— +DI</span>
                  <span style={{ fontSize: "10px", color: "var(--sr-neg)" }}>— −DI</span>
                  <span style={{ fontSize: "10px", color: "var(--sr-warn)", opacity: 0.8 }}>--- 23 threshold</span>
                </div>
                <ResponsiveContainer width="100%" height={75}>
                  <LineChart data={chartData} margin={{ top: 2, right: 10, left: 0, bottom: 2 }} syncId="sc">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--sr-border)" strokeOpacity={0.3} vertical={false} />
                    <XAxis dataKey="date" tick={{ ...AXIS_STYLE, fontSize: 9 }} tickFormatter={v => v.slice(5)} interval="preserveStartEnd" height={14} />
                    <YAxis tick={{ ...AXIS_STYLE, fontSize: 9 }} domain={[0, 60]} width={54} />
                    <ReferenceLine y={23} stroke="var(--sr-warn)" strokeDasharray="3 3" strokeOpacity={0.8} />
                    <Line type="monotone" dataKey="adxVal"  stroke="#E2E8F0"       strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line type="monotone" dataKey="plusDI"  stroke="var(--sr-pos)" strokeWidth={1}   dot={false} isAnimationActive={false} connectNulls={false} strokeOpacity={0.85} />
                    <Line type="monotone" dataKey="minusDI" stroke="var(--sr-neg)" strokeWidth={1}   dot={false} isAnimationActive={false} connectNulls={false} strokeOpacity={0.85} />
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
          </>
        )}

        {/* Legend */}
        <div style={{ display: "flex", gap: "var(--sr-sp-4)", marginTop: "var(--sr-sp-2)", flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-amber)" }}>— Price</span>
          {showEMA && (
            <>
              <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-pos)" }}>— EMA 10</span>
              <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-info)" }}>— EMA 55</span>
            </>
          )}
          {showVP && vp && (
            <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-amber)" }}>
              --- POC ${vp.pocMid.toFixed(0)} · VA ${vp.vaLow.toFixed(0)}–${vp.vaHigh.toFixed(0)}
            </span>
          )}
        </div>
      </div>

      {/* ── Volume Profile card ─────────────────────────────────────────────── */}
      {showVP && vp && vpChartData.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sr-sp-3)" }}>
            <div className="section-label">Volume Profile — {period}</div>
            <div style={{ display: "flex", gap: "var(--sr-sp-4)" }}>
              {[
                { label: "POC",     val: `$${vp.pocMid.toFixed(2)}`,  color: "var(--sr-amber)" },
                { label: "VA High", val: `$${vp.vaHigh.toFixed(2)}`, color: "var(--sr-info)" },
                { label: "VA Low",  val: `$${vp.vaLow.toFixed(2)}`,  color: "var(--sr-info)" },
                { label: "Price vs POC", val: lastPrice > vp.pocMid ? "↑ Above" : "↓ Below",
                  color: lastPrice > vp.pocMid ? "var(--sr-pos)" : "var(--sr-neg)" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "10px", color: "var(--sr-text-3)" }}>{label}</div>
                  <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color }} className="num">{val}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "var(--sr-sp-4)", alignItems: "start" }}>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={vpChartData} layout="vertical" margin={{ top: 2, right: 8, left: 0, bottom: 2 }}>
                <XAxis type="number" tick={{ ...AXIS_STYLE, fontSize: 9 }} tickFormatter={fmtVol} />
                <YAxis type="category" dataKey="label" tick={{ ...AXIS_STYLE, fontSize: 9 }} width={50} interval="preserveStartEnd" />
                <Bar dataKey="vol" isAnimationActive={false} maxBarSize={10}>
                  {vpChartData.map((b, i) => (
                    <Cell key={i}
                      fill={b.isPOC
                        ? "var(--sr-amber)"
                        : b.inVA
                          ? "color-mix(in srgb, var(--sr-info) 50%, transparent)"
                          : "var(--sr-surface-3)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: "11px", paddingTop: 8 }}>
              {[
                { color: "var(--sr-amber)", label: "POC — highest volume" },
                { color: "color-mix(in srgb, var(--sr-info) 50%, transparent)", label: "Value Area (70%)" },
                { color: "var(--sr-surface-3)", label: "Low volume node" },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
                  <span style={{ color: "var(--sr-text-3)" }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TL Confluence™ Panel ─────────────────────────────────────────────── */}
      {showSubpanels && (
        <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sr-sp-4)" }}>
            <div>
              <div className="section-label">TL Confluence™ Strategy</div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
                EMA Alignment · ADX Strength · Squeeze Momentum · Volume Profile
              </div>
            </div>
            {tlResult && (
              <div style={{
                padding: "8px 18px", borderRadius: "var(--sr-radius-pill)", fontWeight: 800,
                fontSize: "var(--sr-t-base)", letterSpacing: "0.08em",
                color: tlResult.biasColor,
                background: `color-mix(in srgb, ${tlResult.biasColor} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${tlResult.biasColor} 35%, transparent)`,
              }}>{tlResult.bias}</div>
            )}
          </div>

          {!tlResult ? (
            <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>
              Enable Squeeze + ADX + VP for full TL Confluence signal computation.
            </div>
          ) : (
            <>
              {/* 4 signal lights */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)" }}>
                {[
                  {
                    label:  "EMA Alignment",
                    active: tlResult.signals.emaLong,
                    detail: tlResult.signals.emaLong  ? "EMA 10 > EMA 55 (bullish)"
                          : tlResult.signals.emaShort ? "EMA 10 < EMA 55 (bearish)"
                          : "Flat / crossing",
                  },
                  {
                    label:  "ADX Trend Strength",
                    active: tlResult.signals.adxActive,
                    detail: tlResult.adxVal != null
                      ? `ADX ${tlResult.adxVal.toFixed(1)} ${tlResult.adxVal > 23 ? "(strong)" : "(weak < 23)"}`
                      : "—",
                  },
                  {
                    label:  "Squeeze Momentum",
                    active: tlResult.signals.sqzLong,
                    detail: tlResult.sqzVal != null
                      ? `Mom ${tlResult.sqzVal.toFixed(4)}${tlResult.signals.sqzLoaded ? " 🔴 squeeze loaded" : ""}`
                      : "—",
                  },
                  {
                    label:  "Volume Profile Pos.",
                    active: tlResult.signals.vpAbove,
                    detail: tlResult.pocMid > 0
                      ? `${lastPrice > tlResult.pocMid ? "↑ Above" : "↓ Below"} POC $${tlResult.pocMid.toFixed(0)}`
                      : "—",
                  },
                ].map(({ label, active, detail }) => (
                  <div key={label} style={{
                    padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)",
                    background: active ? "color-mix(in srgb, var(--sr-pos) 8%, transparent)" : "var(--sr-surface-2)",
                    border: `1px solid ${active ? "color-mix(in srgb, var(--sr-pos) 30%, transparent)" : "var(--sr-border)"}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                        background: active ? "var(--sr-pos)" : "var(--sr-surface-3)",
                        boxShadow: active ? "0 0 4px var(--sr-pos)" : "none",
                      }} />
                      <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: active ? "var(--sr-text)" : "var(--sr-text-3)" }}>
                        {label}
                      </span>
                    </div>
                    <div style={{ fontSize: "10px", color: "var(--sr-text-3)" }}>{detail}</div>
                  </div>
                ))}
              </div>

              {/* ADX quick stats + confluence count */}
              <div style={{ display: "flex", gap: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-4)", padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
                {[
                  { label: "ADX",   val: tlResult.adxVal?.toFixed(1) ?? "—",   color: (tlResult.adxVal ?? 0) > 40 ? "var(--sr-pos)" : (tlResult.adxVal ?? 0) > 23 ? "var(--sr-warn)" : "var(--sr-text-3)" },
                  { label: "+DI",   val: tlResult.plusDI?.toFixed(1) ?? "—",    color: "var(--sr-pos)" },
                  { label: "−DI",   val: tlResult.minusDI?.toFixed(1) ?? "—",   color: "var(--sr-neg)" },
                  { label: "LONG",  val: `${tlResult.longSignals}/4`,           color: "var(--sr-pos)" },
                  { label: "SHORT", val: `${tlResult.shortSignals}/4`,          color: "var(--sr-neg)" },
                ].map(({ label, val, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: "10px", color: "var(--sr-text-3)" }}>{label}</div>
                    <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color }} className="num">{val}</div>
                  </div>
                ))}
              </div>

              {/* Risk management */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)" }}>
                {[
                  { label: "Long Stop",  val: `$${tlResult.stopLong.toFixed(2)}`,  sub: `−${tlResult.riskLong.toFixed(1)}%`,        c: "var(--sr-neg)" },
                  { label: "Long TP1",   val: `$${tlResult.tp1Long.toFixed(2)}`,   sub: `+${(tlResult.riskLong*2).toFixed(1)}%`,     c: "var(--sr-pos)" },
                  { label: "Short Stop", val: `$${tlResult.stopShort.toFixed(2)}`, sub: `+${tlResult.riskShort.toFixed(1)}%`,        c: "var(--sr-neg)" },
                  { label: "Short TP1",  val: `$${tlResult.tp1Short.toFixed(2)}`,  sub: `−${(tlResult.riskShort*2).toFixed(1)}%`,    c: "var(--sr-pos)" },
                ].map(({ label, val, sub, c }) => (
                  <div key={label} style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius-sm)" }}>
                    <div style={{ fontSize: "10px", color: "var(--sr-text-3)" }}>{label}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700 }} className="num">{val}</span>
                      <span style={{ fontSize: "10px", color: c }} className="num">{sub}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* IC Dual Gate */}
              <div style={{
                padding: "var(--sr-sp-3) var(--sr-sp-4)", borderRadius: "var(--sr-radius)",
                background: `color-mix(in srgb, ${tlResult.gateColor} 8%, transparent)`,
                border: `1px solid color-mix(in srgb, ${tlResult.gateColor} 30%, transparent)`,
              }}>
                <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginBottom: 2, letterSpacing: "0.06em" }}>IC DUAL GATE</div>
                <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600, color: tlResult.gateColor }}>{tlResult.gate}</div>
                {icScore == null && (
                  <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 4 }}>
                    Pass icScore prop to enable full IC gate validation.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Sector Context ───────────────────────────────────────────────────── */}
      <div className="card">
        <div className="section-label">Sector Context</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sr-sp-3)" }}>
          {[
            { label: "Sector",   val: profile?.sector   as string ?? "—" },
            { label: "Industry", val: profile?.industry  as string ?? "—" },
            { label: "Beta",     val: quote?.beta != null ? Number(quote.beta).toFixed(2) : "—" },
          ].map(({ label, val }) => (
            <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 600 }}>{val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
