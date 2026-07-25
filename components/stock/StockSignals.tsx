"use client";
import { useMemo } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import type { SubScores, SubScore } from "@/lib/scoring";
import { trendStage, detectBaseBreakout, type OHLCV } from "@/lib/technicalIndicators";

interface Props { subScores: SubScores | null; data: StockData | null; }

const STAGE_META: Record<number, { color: string; blurb: string }> = {
  1: { color: "var(--sr-text-2)", blurb: "Sideways base — sellers exhausted, trend not yet up." },
  2: { color: "var(--sr-pos)",    blurb: "Advancing above a rising 150-day line — trend intact." },
  3: { color: "var(--sr-warn)",   blurb: "Extended above a flattening line — momentum fading." },
  4: { color: "var(--sr-neg)",    blurb: "Declining below a falling 150-day line — trend down." },
};

function toOHLCV(history: Record<string, unknown>[]): OHLCV[] {
  // history is newest-first from FMP → reverse to oldest→newest, keep ~1y.
  return history
    .slice(0, 260)
    .map(h => ({ open: Number(h.open), high: Number(h.high), low: Number(h.low), close: Number(h.close), volume: Number(h.volume) }))
    .filter(b => isFinite(b.close) && isFinite(b.high) && isFinite(b.low))
    .reverse();
}

function scoreColor(s: number): string {
  return s >= 7 ? "var(--sr-pos)" : s >= 4 ? "var(--sr-amber)" : "var(--sr-neg)";
}

function Gauge({ title, sub }: { title: string; sub: SubScore | null }) {
  if (!sub) return (
    <div className="sr-tile">
      <div className="sr-tile-label">{title}</div>
      <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: "var(--sr-text-3)" }}>—</div>
      <div className="sr-hint">Not enough data</div>
    </div>
  );
  const col = scoreColor(sub.score);
  return (
    <div className="sr-tile">
      <div className="sr-tile-label">{title}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: col }} className="num">{sub.score.toFixed(1)}</span>
        <span className="sr-hint">/ 10</span>
      </div>
      <div style={{ height: 6, background: "var(--sr-surface-3)", borderRadius: 3, overflow: "hidden", margin: "6px 0 8px" }}>
        <div style={{ height: "100%", width: `${sub.score * 10}%`, background: col, borderRadius: 3 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {sub.factors.map(f => (
          <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 34, height: 3, borderRadius: 2, background: "var(--sr-surface-3)", position: "relative", flexShrink: 0 }}>
              <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.round(f.strength * 100)}%`, background: scoreColor(f.strength * 10), borderRadius: 2 }} />
            </span>
            <span className="sr-hint">{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StockSignals({ subScores, data }: Props) {
  const ohlcv = useMemo(() => toOHLCV(data?.history ?? []), [data]);
  const stage = useMemo(() => (ohlcv.length >= 30 ? trendStage(ohlcv) : null), [ohlcv]);
  const bb = useMemo(() => (ohlcv.length >= 31 ? detectBaseBreakout(ohlcv) : null), [ohlcv]);
  const price = ohlcv.length ? ohlcv[ohlcv.length - 1].close : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-5)" }}>
      {/* Quality sub-scores */}
      <div className="card">
        <div className="section-label">Quality sub-scores</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", maxWidth: 560, lineHeight: 1.5 }}>
          Two plain 0-10 gauges drawn from the same fundamentals the Scora Score uses — the durability of the
          business and the quality of its cash generation.
        </div>
        <div className="sr-grid-2">
          <Gauge title="Moat" sub={subScores?.moat ?? null} />
          <Gauge title="Cash-flow quality" sub={subScores?.cashFlow ?? null} />
        </div>
      </div>

      {/* Trend layer */}
      <div className="card">
        <div className="section-label">Trend &amp; entry</div>
        {!stage ? (
          <div className="sr-hint">Not enough price history for a trend read.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-4)" }}>
            {/* Stage */}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-4)", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {[1, 2, 3, 4].map(s => (
                  <span key={s} title={STAGE_META[s].blurb} style={{
                    width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "var(--sr-t-xs)", fontWeight: 800,
                    background: s === stage.stage ? STAGE_META[s].color : "var(--sr-surface-3)",
                    color: s === stage.stage ? "var(--sr-bg)" : "var(--sr-text-3)",
                    border: s === stage.stage ? "none" : "1px solid var(--sr-border)",
                  }}>{s}</span>
                ))}
              </div>
              <div>
                <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 800, color: STAGE_META[stage.stage].color }}>
                  Stage {stage.stage} · {stage.label}
                </div>
                <div className="sr-hint" style={{ maxWidth: 420, lineHeight: 1.4 }}>{STAGE_META[stage.stage].blurb}</div>
              </div>
            </div>

            {/* 150-day line facts */}
            <div className="sr-grid-3">
              <div className="sr-tile">
                <div className="sr-tile-label">150-day MA</div>
                <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num">{stage.sma150 != null ? `$${stage.sma150.toFixed(2)}` : "—"}</div>
                <div className="sr-hint">{price != null && stage.sma150 != null ? (price > stage.sma150 ? "Price above" : "Price below") : ""}</div>
              </div>
              <div className="sr-tile">
                <div className="sr-tile-label">150-day slope (20d)</div>
                <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: stage.slopePct == null ? "var(--sr-text-3)" : stage.slopePct > 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
                  {stage.slopePct == null ? "—" : `${stage.slopePct > 0 ? "+" : ""}${stage.slopePct.toFixed(1)}%`}
                </div>
                <div className="sr-hint">Trend direction</div>
              </div>
              <div className="sr-tile">
                <div className="sr-tile-label">Base breakout</div>
                <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: bb?.status === "base-breakout" ? "var(--sr-pos)" : bb?.status === "in-base" ? "var(--sr-amber)" : "var(--sr-text-3)" }}>
                  {bb?.status === "base-breakout" ? "Breaking out" : bb?.status === "in-base" ? "In base" : "No base"}
                </div>
                <div className="sr-hint">
                  {bb?.volumeRatio != null ? `Vol ${bb.volumeRatio.toFixed(1)}× avg${bb.volumeConfirmed ? " ✓" : ""}` : "—"}
                </div>
              </div>
            </div>

            {bb?.status === "base-breakout" && (
              <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", fontSize: "var(--sr-t-xs)", lineHeight: 1.5,
                background: bb.volumeConfirmed && bb.aboveTrend ? "color-mix(in srgb, var(--sr-pos) 10%, transparent)" : "color-mix(in srgb, var(--sr-amber) 10%, transparent)",
                color: bb.volumeConfirmed && bb.aboveTrend ? "var(--sr-pos)" : "var(--sr-amber)" }}>
                {bb.volumeConfirmed && bb.aboveTrend
                  ? `Breakout above the base high${bb.baseHigh != null ? ` ($${bb.baseHigh.toFixed(2)})` : ""} on ${bb.volumeRatio?.toFixed(1)}× volume, price above the 150-day line — a confirmed setup.`
                  : `Price cleared the base high${bb.baseHigh != null ? ` ($${bb.baseHigh.toFixed(2)})` : ""} but ${!bb.volumeConfirmed ? "without a 2× volume expansion" : ""}${!bb.volumeConfirmed && !bb.aboveTrend ? " and " : ""}${!bb.aboveTrend ? "below the 150-day line" : ""} — unconfirmed.`}
              </div>
            )}
            <div className="sr-hint" style={{ lineHeight: 1.5 }}>
              Trend context, not a recommendation. Scora&apos;s directional call folds price, trend and macro together on the Research tab.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
