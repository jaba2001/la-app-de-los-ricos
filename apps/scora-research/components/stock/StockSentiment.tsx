"use client";
import type { StockData } from "@/app/stock/[ticker]/page";
import { Sk } from "@/components/ui/Skeleton";

interface Props { data: StockData | null; loading: boolean; }

function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null) return "—";
  return v.toFixed(decimals);
}

function fmtPct(v: number | null | undefined, decimals = 2): string {
  if (v == null) return "—";
  const pct = v * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(decimals)}%`;
}

function fmtPctRaw(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

function rc(v: number | null | undefined, invert = false) {
  if (v == null) return "var(--sr-text-3)";
  const pos = invert ? v < 0 : v > 0;
  const neg = invert ? v > 0 : v < 0;
  return pos ? "var(--sr-pos)" : neg ? "var(--sr-neg)" : "var(--sr-text-3)";
}

function Arrow({ v }: { v: number | null | undefined }) {
  if (v == null) return null;
  return <span style={{ color: v > 0 ? "var(--sr-pos)" : v < 0 ? "var(--sr-neg)" : "var(--sr-text-3)" }}>{v > 0 ? "▲" : "▼"}</span>;
}

function Cell({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="sr-tile">
      <div className="sr-tile-label">{label}</div>
      <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num">{value}</div>
      {sub && <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function StockSentiment({ data, loading }: Props) {
  const fv = data?.finviz ?? null;

  if (loading) {
    return (
      <div className="animate-fade-in">
        <Sk w="100%" h={600} />
      </div>
    );
  }

  /* Short float bar color */
  const sfPct = fv?.shortFloat != null ? fv.shortFloat * 100 : null;
  const sfColor = sfPct == null ? "var(--sr-text-3)"
    : sfPct > 20 ? "var(--sr-neg)"
    : sfPct > 10 ? "var(--sr-warn)"
    : sfPct < 5  ? "var(--sr-pos)"
    : "var(--sr-text-2)";

  /* Recom color: 1-2 = buy (green), 3 = hold (amber), 4-5 = sell (red) */
  const recommColor = fv?.recom == null ? "var(--sr-text-3)"
    : fv.recom <= 2   ? "var(--sr-pos)"
    : fv.recom <= 3   ? "var(--sr-amber)"
    : "var(--sr-neg)";
  const recommLabel = fv?.recom == null ? "—"
    : fv.recom <= 1.5 ? "Strong Buy"
    : fv.recom <= 2.5 ? "Buy"
    : fv.recom <= 3.5 ? "Hold"
    : fv.recom <= 4.5 ? "Sell"
    : "Strong Sell";

  const relVolColor = fv?.relVolume == null ? "var(--sr-text-3)"
    : fv.relVolume > 2   ? "var(--sr-pos)"
    : fv.relVolume > 1.5 ? "var(--sr-amber)"
    : fv.relVolume < 0.5 ? "var(--sr-text-3)"
    : "var(--sr-text-2)";

  const SectionTitle = ({ title }: { title: string }) => (
    <div className="section-label" style={{ marginBottom: "var(--sr-sp-3)" }}>{title}</div>
  );

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-5)" }}>

      {/* Short Interest */}
      <div className="card">
        <SectionTitle title="Short Interest" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-3)" }}>
          <Cell
            label="Short Float"
            value={<span style={{ color: sfColor }}>{sfPct != null ? `${sfPct.toFixed(2)}%` : "—"}</span>}
            sub="% of float shorted"
          />
          <Cell
            label="Short Ratio"
            value={<span style={{ color: "var(--sr-text-2)" }}>{fmt(fv?.shortRatio, 1)}</span>}
            sub="days to cover"
          />
          {fv?.shortVolumeRatio != null && (
            <Cell
              label="Short Volume"
              value={<span style={{ color: fv.shortVolumeRatio > 0.55 ? "var(--sr-neg)" : fv.shortVolumeRatio > 0.45 ? "var(--sr-warn)" : "var(--sr-text-2)" }}>{`${(fv.shortVolumeRatio * 100).toFixed(0)}%`}</span>}
              sub="of daily volume (FINRA)"
            />
          )}
        </div>
        {/* Short float visual bar */}
        {sfPct != null && (
          <div style={{ marginTop: "var(--sr-sp-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>
              <span>0%</span>
              <span style={{ color: sfColor, fontWeight: 600 }}>{sfPct.toFixed(2)}% short float</span>
              <span>50%+</span>
            </div>
            <div style={{ height: 6, background: "var(--sr-surface-3)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${Math.min(100, (sfPct / 50) * 100)}%`,
                background: sfColor,
                borderRadius: 3,
                transition: "width 400ms ease",
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--sr-text-3)", marginTop: 4 }}>
              <span style={{ color: "var(--sr-pos)" }}>Low (&lt;5%)</span>
              <span style={{ color: "var(--sr-warn)" }}>Elevated (10-20%)</span>
              <span style={{ color: "var(--sr-neg)" }}>High (&gt;20%)</span>
            </div>
          </div>
        )}
      </div>

      {/* Ownership Flows */}
      <div className="card">
        <SectionTitle title="Ownership Flows" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--sr-sp-3)" }}>
          <Cell
            label="Inst Own"
            value={<span style={{ color: "var(--sr-text-2)" }}>{fv?.instOwn != null ? `${(fv.instOwn * 100).toFixed(1)}%` : "—"}</span>}
            sub="% institutional ownership"
          />
          <Cell
            label="Inst Trans"
            value={
              <span style={{ color: rc(fv?.instTrans) }}>
                <Arrow v={fv?.instTrans} /> {fmtPct(fv?.instTrans)}
              </span>
            }
            sub="quarterly institutional flow"
          />
          <Cell
            label="Insider Own"
            value={<span style={{ color: "var(--sr-text-2)" }}>{fv?.insiderOwn != null ? `${(fv.insiderOwn * 100).toFixed(1)}%` : "—"}</span>}
            sub="% insider ownership"
          />
          <Cell
            label="Insider Trans"
            value={
              <span style={{ color: rc(fv?.insiderTrans) }}>
                <Arrow v={fv?.insiderTrans} /> {fmtPct(fv?.insiderTrans)}
              </span>
            }
            sub="quarterly insider flow"
          />
        </div>
      </div>

      {/* Activity */}
      <div className="card">
        <SectionTitle title="Trading Activity" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--sr-sp-3)" }}>
          <Cell
            label="Rel Volume"
            value={<span style={{ color: relVolColor }}>{fv?.relVolume != null ? `${fv.relVolume.toFixed(2)}x` : "—"}</span>}
            sub="vs avg volume"
          />
          <Cell
            label="ATR"
            value={<span style={{ color: "var(--sr-text-2)" }}>{fv?.atr != null ? `$${fmt(fv.atr, 2)}` : "—"}</span>}
            sub="avg true range"
          />
          <Cell
            label="Volatility 14D"
            value={<span style={{ color: "var(--sr-text-2)" }}>{fv?.volatility14d != null ? `${(fv.volatility14d * 100).toFixed(2)}%` : "—"}</span>}
            sub="daily avg move"
          />
        </div>
      </div>

      {/* Analyst Sentiment */}
      <div className="card">
        <SectionTitle title="Analyst Sentiment" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--sr-sp-3)" }}>
          <Cell
            label="Recommendation"
            value={<span style={{ color: recommColor }}>{recommLabel}</span>}
            sub={fv?.recom != null ? `Score: ${fv.recom.toFixed(2)} (1=Buy, 5=Sell)` : undefined}
          />
          <Cell
            label="Target Price"
            value={<span style={{ color: "var(--sr-text-2)" }}>{fv?.targetPrice != null ? `$${fmt(fv.targetPrice, 2)}` : "—"}</span>}
            sub="analyst consensus target"
          />
          <Cell
            label="Forward P/E"
            value={<span style={{ color: "var(--sr-text-2)" }}>{fmt(fv?.forwardPe, 1)}</span>}
            sub="next-12M earnings"
          />
          <Cell
            label="PEG"
            value={<span style={{ color: fv?.peg != null ? (fv.peg < 1 ? "var(--sr-pos)" : fv.peg < 2 ? "var(--sr-text-2)" : "var(--sr-neg)") : "var(--sr-text-3)" }}>{fmt(fv?.peg, 2)}</span>}
            sub="price/earnings/growth"
          />
        </div>
      </div>

      {/* Growth Signals */}
      <div className="card">
        <SectionTitle title="Growth Signals" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--sr-sp-3)" }}>
          <Cell
            label="EPS Q/Q"
            value={<span style={{ color: rc(fv?.epsQoQ) }}><Arrow v={fv?.epsQoQ} /> {fmtPct(fv?.epsQoQ)}</span>}
            sub="earnings acceleration"
          />
          <Cell
            label="Sales Q/Q"
            value={<span style={{ color: rc(fv?.salesQoQ) }}><Arrow v={fv?.salesQoQ} /> {fmtPct(fv?.salesQoQ)}</span>}
            sub="revenue acceleration"
          />
          <Cell
            label="EPS Next Y"
            value={<span style={{ color: rc(fv?.epsNextY) }}><Arrow v={fv?.epsNextY} /> {fmtPct(fv?.epsNextY)}</span>}
            sub="next-year EPS growth est."
          />
          <Cell
            label="EPS Next 5Y"
            value={<span style={{ color: rc(fv?.epsNext5Y) }}><Arrow v={fv?.epsNext5Y} /> {fmtPct(fv?.epsNext5Y)}</span>}
            sub="5-year EPS CAGR est."
          />
          <Cell
            label="Sales 3Y CAGR"
            value={<span style={{ color: rc(fv?.salesGrowth3Y) }}><Arrow v={fv?.salesGrowth3Y} /> {fmtPct(fv?.salesGrowth3Y)}</span>}
            sub="3-year revenue CAGR"
          />
        </div>
      </div>

      {/* Margins */}
      <div className="card">
        <SectionTitle title="Margins" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--sr-sp-3)" }}>
          <Cell
            label="Operating Margin"
            value={<span style={{ color: fv?.operatingMargin != null ? (fv.operatingMargin > 0.15 ? "var(--sr-pos)" : fv.operatingMargin > 0 ? "var(--sr-text-2)" : "var(--sr-neg)") : "var(--sr-text-3)" }}>
              {fv?.operatingMargin != null ? `${(fv.operatingMargin * 100).toFixed(1)}%` : "—"}
            </span>}
          />
          <Cell
            label="Profit Margin"
            value={<span style={{ color: rc(fv?.profitMargin) }}>
              {fv?.profitMargin != null ? `${(fv.profitMargin * 100).toFixed(1)}%` : "—"}
            </span>}
          />
          <Cell
            label="Gross Margin"
            value={<span style={{ color: "var(--sr-text-2)" }}>
              {fv?.grossMarginFv != null ? `${(fv.grossMarginFv * 100).toFixed(1)}%` : "—"}
            </span>}
          />
          <Cell
            label="ROA"
            value={<span style={{ color: rc(fv?.roa) }}>
              {fv?.roa != null ? `${(fv.roa * 100).toFixed(1)}%` : "—"}
            </span>}
          />
          <Cell
            label="ROE"
            value={<span style={{ color: rc(fv?.roe) }}>
              {fv?.roe != null ? `${(fv.roe * 100).toFixed(1)}%` : "—"}
            </span>}
          />
        </div>
      </div>

      {/* Long-term Performance */}
      <div className="card">
        <SectionTitle title="Long-term Performance" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--sr-sp-3)" }}>
          <Cell
            label="Perf 1Y"
            value={<span style={{ color: rc(fv?.perfYear) }}>{fmtPct(fv?.perfYear)}</span>}
          />
          <Cell
            label="Perf 3Y"
            value={<span style={{ color: rc(fv?.perf3Y) }}>{fmtPct(fv?.perf3Y)}</span>}
          />
          <Cell
            label="Perf 5Y"
            value={<span style={{ color: rc(fv?.perf5Y) }}>{fmtPct(fv?.perf5Y)}</span>}
          />
        </div>
      </div>

      {/* Powered by watermark */}
      <div style={{ textAlign: "right", fontSize: "10px", color: "var(--sr-text-3)", paddingRight: "var(--sr-sp-2)" }}>
        Fundamentals via Finnhub · short interest via NASDAQ/FINRA · ownership needs a paid feed
      </div>

    </div>
  );
}
