"use client";
// "Why did it move?" — return attribution card.
//
// Answers the first question anyone has when they open a quote, with a decomposition
// instead of an opinion: how much of the move was the market, how much was the sector,
// and how much was actually the company. Runs entirely on series the page already
// fetched (history / spyHistory / sectorEtfHistory) — no extra network call.

import { useMemo, useState } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import { attributeReturn, toDatedCloses, dominantDriver, type AttributionKey } from "@/lib/attribution";
import { Sk } from "@/components/ui/Skeleton";

const HORIZONS: { days: number; label: string; word: string }[] = [
  { days: 1, label: "1D", word: "today" },
  { days: 5, label: "1W", word: "this week" },
  { days: 21, label: "1M", word: "this month" },
];

const BUCKET_COLOR: Record<AttributionKey, string> = {
  market: "var(--sr-info)",
  sector: "#8B5CF6",
  idio: "var(--sr-amber)",
};

const BUCKET_HINT: Record<AttributionKey, string> = {
  market: "Beta-weighted move of the S&P 500",
  sector: "Sector ETF beyond what the market explains",
  idio: "What is left over — the company itself",
};

/** Percentage points, always signed, two decimals. */
const pp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} pp`;
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;

interface Props {
  data: StockData | null;
  loading: boolean;
  ticker: string;
}

export default function WhyMoved({ data, loading, ticker }: Props) {
  const [horizon, setHorizon] = useState(1);

  const series = useMemo(() => {
    if (!data) return null;
    const stock = toDatedCloses(data.history);
    const market = toDatedCloses(data.spyHistory);
    // An unknown sector falls back to SPY upstream; passing it as a sector leg would
    // just re-explain the market with itself, so drop it instead.
    const sectorSym = data.sectorEtfSymbol;
    const sector = sectorSym && sectorSym !== "SPY" ? toDatedCloses(data.sectorEtfHistory) : null;
    return { stock, market, sector, sectorSym };
  }, [data]);

  const attr = useMemo(() => {
    if (!series || series.stock.length === 0 || series.market.length === 0) return null;
    return attributeReturn({
      stock: series.stock,
      market: series.market,
      sector: series.sector,
      horizonDays: horizon,
    });
  }, [series, horizon]);

  /** Earnings inside the attributed window — the one residual label we can state as
   *  fact from data on hand. Everything else would be storytelling. */
  const earningsInWindow = useMemo(() => {
    if (!data || !series || series.stock.length <= horizon) return false;
    const to = series.stock[0].date;
    const from = series.stock[horizon].date;
    const rows = data.earningsSurprises ?? [];
    return rows.some((e) => {
      const d = typeof e.date === "string" ? e.date.slice(0, 10) : null;
      return !!d && d > from && d <= to;
    });
  }, [data, series, horizon]);

  const horizonMeta = HORIZONS.find((h) => h.days === horizon) ?? HORIZONS[0];

  if (loading) return <Sk w="100%" h={190} />;

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-3)" }}>
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)" }}>
        <div className="section-label" style={{ margin: 0 }}>Why it moved</div>
        <div style={{ display: "flex", gap: 4 }}>
          {HORIZONS.map((h) => (
            <button
              key={h.days}
              type="button"
              onClick={() => setHorizon(h.days)}
              className={`subtab ${horizon === h.days ? "active" : ""}`}
              aria-pressed={horizon === h.days}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {!attr ? (
        <div className="sr-hint">
          Not enough overlapping price history to attribute this move honestly.
        </div>
      ) : (
        <>
          {/* Headline: the realized move, then the one-line decomposition. */}
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
            <span
              className="num"
              style={{
                fontSize: "var(--sr-t-2xl)",
                fontWeight: 700,
                color: attr.totalReturn >= 0 ? "var(--sr-pos)" : "var(--sr-neg)",
              }}
            >
              {pct(attr.totalReturn)}
            </span>
            <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>
              {ticker} {horizonMeta.word}
            </span>
          </div>

          <p style={{ fontSize: "var(--sr-t-base)", color: "var(--sr-text-2)", margin: "var(--sr-sp-2) 0 var(--sr-sp-3)" }}>
            {attr.components.map((c, i) => (
              <span key={c.key}>
                {i > 0 ? " · " : ""}
                <strong className="num" style={{ color: BUCKET_COLOR[c.key] }}>{pp(c.contribution)}</strong>{" "}
                {c.label.toLowerCase()}
              </span>
            ))}
          </p>

          {/* Stacked magnitude bar — how much of the MOVEMENT each bucket accounts for.
              Buckets can offset each other, so this is |contribution| share, not signed. */}
          <div
            style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--sr-surface-2)" }}
            role="img"
            aria-label={attr.components.map((c) => `${c.label} ${(c.share * 100).toFixed(0)}%`).join(", ")}
          >
            {attr.components.map((c) => (
              <div key={c.key} style={{ width: `${c.share * 100}%`, background: BUCKET_COLOR[c.key] }} />
            ))}
          </div>

          <div
            className={attr.components.length === 3 ? "sr-grid-3" : "sr-grid-2"}
            style={{ marginTop: "var(--sr-sp-3)" }}
          >
            {attr.components.map((c) => (
              <div key={c.key} className="sr-tile" title={BUCKET_HINT[c.key]}>
                <div className="sr-tile-label" style={{ color: BUCKET_COLOR[c.key] }}>{c.label}</div>
                <div className="num" style={{ fontSize: "var(--sr-t-md)", fontWeight: 700 }}>{pp(c.contribution)}</div>
                <div className="sr-hint">{(c.share * 100).toFixed(0)}% of the move</div>
              </div>
            ))}
          </div>

          {earningsInWindow && (
            <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)", color: "var(--sr-warn)" }}>
              Earnings landed inside this window — expect the company bucket to carry it.
            </div>
          )}

          {/* Method, stated plainly. The whole point of this card is that the number can
              be checked, so the inputs that produced it are not hidden in a tooltip. */}
          <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>
            β {attr.betaMarket.toFixed(2)} vs SPY
            {attr.betaSector !== null && series?.sectorSym ? ` · β ${attr.betaSector.toFixed(2)} vs ${series.sectorSym} (market-neutralized)` : ""}
            {" · "}estimated on {attr.sampleDays} trading days · buckets sum to the realized return by construction
          </div>
        </>
      )}
    </div>
  );
}

/** Compact one-liner for headers and the daily report. Null when the move is noise. */
export function whyMovedSentence(
  ticker: string,
  data: StockData | null,
  horizonDays = 1,
): string | null {
  if (!data) return null;
  const stock = toDatedCloses(data.history);
  const market = toDatedCloses(data.spyHistory);
  const sector = data.sectorEtfSymbol && data.sectorEtfSymbol !== "SPY" ? toDatedCloses(data.sectorEtfHistory) : null;
  const a = attributeReturn({ stock, market, sector, horizonDays });
  if (!a) return null;
  const drv = dominantDriver(a);
  if (!drv) return `${ticker} is flat — nothing worth attributing.`;
  const parts = a.components.map((c) => `${pp(c.contribution)} ${c.label.toLowerCase()}`).join(", ");
  return `${ticker} ${pct(a.totalReturn)}: ${parts}.`;
}
