"use client";
// Answer-first verdict bar.
//
// The call, the three reasons, and the falsifier — above the fold, on every tab. The
// depth stays exactly where it was; this only fixes the ordering, so the first five
// seconds answer the question instead of presenting thirteen tabs of raw material.
//
// Reads `buildVerdict`, the same function the Overview panel uses, so the headline and
// the detail can never show two different calls for the same name.

import { useMemo } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import type { MacroState, Scores } from "@/lib/types";
import { buildVerdict, deriveTechnicals } from "@/lib/verdict";
import { toDatedCloses } from "@/lib/attribution";
import { HORIZON_LABEL, type Horizon } from "@/lib/rating";
import { useHorizon, setHorizon } from "@/lib/horizon";
import type { RegimeId } from "@/lib/timeframes";

const HORIZONS: Horizon[] = ["days", "months", "years"];

interface Props {
  data: StockData | null;
  macro: MacroState | null;
  scores: Scores | null;
  icScore: number | null;
  loading: boolean;
}

const closesOf = (rows: Record<string, unknown>[] | null | undefined): number[] =>
  toDatedCloses(rows).map((p) => p.close);

export default function Verdict({ data, macro, scores, icScore, loading }: Props) {
  // Shared across every reader of the horizon, so this bar and the top-down panel below
  // can never show two different calls for the same name.
  const horizon = useHorizon();

  const verdict = useMemo(() => {
    if (!data || !scores) return null;
    const technicals = deriveTechnicals({
      stockCloses: closesOf(data.history),
      spyCloses: closesOf(data.spyHistory),
      sectorCloses: closesOf(data.sectorEtfHistory),
      price: data.quote?.price != null ? Number(data.quote.price) : null,
    });
    return buildVerdict({
      scores,
      icScore,
      regime: (macro?.regime_id as RegimeId) ?? null,
      riskOn: macro?.risk_on != null ? Number(macro.risk_on) : null,
      impliedCorr: macro?.implied_corr != null ? Number(macro.implied_corr) : null,
      sector: (data.profile?.sector as string) ?? null,
      technicals,
      horizon,
    });
  }, [data, macro, scores, icScore, horizon]);

  // Before the first analysis there is nothing to be answer-first about.
  if (loading || !verdict) return null;

  const convColor =
    verdict.conviction === "High" ? "var(--sr-pos)" :
    verdict.conviction === "Medium" ? "var(--sr-warn)" : "var(--sr-text-3)";

  return (
    <div
      className="card"
      style={{ marginBottom: "var(--sr-sp-4)", borderLeft: `3px solid ${verdict.color}` }}
    >
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: verdict.color }}>
            {verdict.rating}
          </span>
          <span className="num sr-hint">{verdict.directional}/100 directional</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: convColor }}>
            {verdict.conviction} conviction · {verdict.convictionPct}%
          </span>
          {/* Holding period is the first thing that decides whether a name is a good idea,
              and almost nothing asks. Changing it re-weights the call, it does not hide it. */}
          <div style={{ display: "flex", gap: 4 }} role="group" aria-label="Holding period">
            {HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={`subtab ${horizon === h ? "active" : ""}`}
                aria-pressed={horizon === h}
                title={`Rate this name on a ${HORIZON_LABEL[h].toLowerCase()} view`}
              >
                {HORIZON_LABEL[h]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginBottom: "var(--sr-sp-3)", lineHeight: 1.5 }}>
        {verdict.summary}
      </div>

      {verdict.reasons.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: `0 0 var(--sr-sp-3)`, display: "flex", flexDirection: "column", gap: 4 }}>
          {verdict.reasons.map((r, i) => (
            <li key={i} style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", display: "flex", gap: "var(--sr-sp-2)" }}>
              <span style={{ color: verdict.color, flexShrink: 0 }}>▸</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      {/* The falsifier. A call you cannot disprove is marketing, not research. */}
      <div className="sr-hint" style={{ borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-2)" }}>
        <strong style={{ color: "var(--sr-text-2)" }}>What would change this:</strong> {verdict.whatWouldChangeIt}
      </div>

      <div className="sr-hint" style={{ marginTop: 4 }}>{verdict.note}</div>
    </div>
  );
}
