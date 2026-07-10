"use client";
import { useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/proxy";
import type { MacroState } from "@/lib/types";
import {
  ALLOC_ASSETS, ASSET_META, computeRiskOn, buildAllocation,
  type AllocAsset,
} from "@/lib/allocation";

interface Props { macro: MacroState | null; }

interface Close { date: string; close: number; }

function toCloses(raw: unknown): Close[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = r as Record<string, unknown>;
      const c = o.adjClose ?? o.close; // prefer total-return adjusted
      return { date: String(o.date ?? "").slice(0, 10), close: Number(c) };
    })
    .filter((r) => r.date && !isNaN(r.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const shiftMonths = (d: string, n: number) => {
  const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10);
};
function closeOnOrBefore(sorted: Close[], date: string): number | null {
  let lo = 0, hi = sorted.length - 1, ans: number | null = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (sorted[m].date <= date) { ans = sorted[m].close; lo = m + 1; } else hi = m - 1; }
  return ans;
}
// 12-1m absolute momentum (%) — skip the most recent month (Antonacci/Jegadeesh convention).
function mom12_1(closes: Close[]): number | null {
  if (closes.length < 20) return null;
  const last = closes[closes.length - 1].date;
  const c1 = closeOnOrBefore(closes, shiftMonths(last, -1));
  const c12 = closeOnOrBefore(closes, shiftMonths(last, -12));
  return c1 != null && c12 != null && c12 > 0 ? (c1 / c12 - 1) * 100 : null;
}
// Trailing 63-day realized volatility (std of daily log returns) — for A6 risk-parity sizing.
function vol63(closes: Close[]): number | null {
  if (closes.length < 45) return null;
  const rets: number[] = [];
  for (let i = Math.max(1, closes.length - 63); i < closes.length; i++) {
    const p0 = closes[i - 1].close, p1 = closes[i].close;
    if (p0 > 0 && p1 > 0) rets.push(Math.log(p1 / p0));
  }
  if (rets.length < 40) return null;
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  return Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1));
}

export default function AllWeatherAllocator({ macro }: Props) {
  const [mom, setMom] = useState<Partial<Record<AllocAsset, number | null>> | null>(null);
  const [vols, setVols] = useState<Partial<Record<AllocAsset, number | null>> | null>(null);
  const [momLoading, setMomLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setMomLoading(true);
    Promise.all(
      ALLOC_ASSETS.map((t) =>
        authedFetch<unknown>(`/api/fmp/historical-price-eod/full?symbol=${t}`)
          .then((raw) => { const c = toCloses(raw); return [t, mom12_1(c), vol63(c)] as const; })
          .catch(() => [t, null, null] as const)
      )
    ).then((triples) => {
      if (!alive) return;
      const m: Partial<Record<AllocAsset, number | null>> = {};
      const v: Partial<Record<AllocAsset, number | null>> = {};
      for (const [t, mv, vv] of triples) { m[t] = mv; v[t] = vv; }
      setMom(m); setVols(v); setMomLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const riskOn = useMemo(() => {
    if (!macro) return 50;
    if (macro.risk_on != null) return macro.risk_on;
    return computeRiskOn({ lcc: macro.liquidity_cycle, rpc: macro.recession_prob, csc: macro.credit_stress });
  }, [macro]);

  const alloc = useMemo(() => buildAllocation({ riskOn, momentum: mom ?? undefined, vols: vols ?? undefined }), [riskOn, mom, vols]);

  if (!macro) return null;

  const ordered = [...ALLOC_ASSETS].sort((a, b) => alloc.weights[b] - alloc.weights[a]);

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-3)" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>All-Weather Allocator</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, maxWidth: 460, lineHeight: 1.5 }}>
            Liquidity-led risk-on tilt across six liquid ETFs, with a 12-1m momentum trend gate and inverse-vol (risk-parity) sizing. The multi-asset engine — where the measured edge lives.
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 2 }}>Risk-on gauge</div>
          <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: alloc.tiltColor, lineHeight: 1 }} className="num">{riskOn.toFixed(0)}</div>
          <div style={{ fontSize: "10px", fontWeight: 700, color: alloc.tiltColor, textTransform: "uppercase", letterSpacing: "0.06em" }}>{alloc.tiltLabel}</div>
        </div>
      </div>

      {/* Risk-on gauge bar */}
      <div style={{ position: "relative", height: 8, borderRadius: 4, marginBottom: "var(--sr-sp-4)", background: "linear-gradient(90deg, color-mix(in srgb, var(--sr-neg) 45%, transparent), color-mix(in srgb, var(--sr-warn) 40%, transparent), color-mix(in srgb, var(--sr-pos) 45%, transparent))" }}>
        <div style={{ position: "absolute", top: -3, left: `calc(${Math.max(0, Math.min(100, riskOn))}% - 7px)`, width: 14, height: 14, borderRadius: "50%", background: alloc.tiltColor, border: "2px solid var(--sr-surface)", boxShadow: "0 1px 4px rgba(0,0,0,.3)", transition: "left 500ms ease" }} />
      </div>

      {/* Target weights */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-2)" }}>
        {ordered.map((a) => {
          const w = alloc.weights[a];
          const meta = ASSET_META[a];
          const gated = alloc.movedToCash.includes(a);
          const wpct = Math.round(w * 100);
          const m = mom?.[a];
          return (
            <div key={a} style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", opacity: w < 0.005 ? 0.45 : 1 }}>
              <div style={{ minWidth: 48, padding: "3px 8px", borderRadius: "var(--sr-radius-pill)", textAlign: "center", background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${meta.color} 30%, transparent)` }}>
                <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: meta.color }}>{a}</span>
              </div>
              <div style={{ minWidth: 118 }}>
                <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600, color: "var(--sr-text)" }}>{meta.label}</div>
                <div className="sr-hint">
                  {meta.role}
                  {m != null && <span style={{ marginLeft: 6, color: m > 0 ? "var(--sr-pos)" : "var(--sr-neg)" }}>· 12-1m {m > 0 ? "+" : ""}{m.toFixed(0)}%</span>}
                </div>
              </div>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--sr-surface-3)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${wpct}%`, background: meta.color, borderRadius: 3, transition: "width 500ms ease" }} />
              </div>
              <div style={{ minWidth: 64, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                {gated && <span title="Moved to cash by the momentum gate" style={{ fontSize: "9px", fontWeight: 700, color: "var(--sr-neg)", padding: "1px 5px", borderRadius: "var(--sr-radius-pill)", background: "color-mix(in srgb, var(--sr-neg) 12%, transparent)" }}>→ cash</span>}
                <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: "var(--sr-text)" }} className="num">{wpct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Rationale */}
      <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.6 }}>
        {alloc.rationale.map((r, i) => <div key={i}>{momLoading && i === 1 ? "Computing 12-1m momentum trend gate…" : r}</div>)}
      </div>

      {/* Validated backtest anchor */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-4)", marginTop: "var(--sr-sp-3)", paddingTop: "var(--sr-sp-3)", borderTop: "1px solid var(--sr-border)" }}>
        {[
          { k: "Backtest 2007–2026", v: "Sharpe 1.01" },
          { k: "Max drawdown", v: "−7.5%" },
          { k: "vs SPY buy & hold", v: "0.72 · −50.7%" },
        ].map((s) => (
          <div key={s.k}>
            <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.k}</div>
            <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: "var(--sr-text)" }} className="num">{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "var(--sr-sp-2)", fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.5 }}>
        Out-of-sample, net of costs, regime-independent control beaten in both sub-periods. Educational — not investment advice; ETF examples, not recommendations.
      </div>
    </div>
  );
}
