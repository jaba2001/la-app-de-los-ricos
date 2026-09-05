"use client";
import { useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/proxy";
import { computeExposure, detectTheme, type Position, type Bucket } from "@/lib/exposure";

interface Trade { ticker: string; shares: number; price: number; thesis: string | null; sector: string | null; }
interface Props { trades: Trade[]; marks: Record<string, number>; }

function BarRow({ b, color }: { b: Bucket; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)" }}>
      <div style={{ minWidth: 150, fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.key}</div>
      <div style={{ flex: 1, height: 8, background: "var(--sr-surface-3)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(100, b.weight * 100)}%`, background: color, borderRadius: 4 }} />
      </div>
      <div style={{ minWidth: 44, textAlign: "right", fontSize: "var(--sr-t-xs)", fontWeight: 700 }} className="num">{(b.weight * 100).toFixed(0)}%</div>
    </div>
  );
}

export default function ExposureAudit({ trades, marks }: Props) {
  const [sectors, setSectors] = useState<Record<string, string>>({});

  const tickers = useMemo(() => Array.from(new Set(trades.map(t => t.ticker.toUpperCase()))), [trades]);

  // Sectors (profile is cached 7d on the proxy → cheap). Falls back to any stored sector.
  useEffect(() => {
    let alive = true;
    const need = tickers.filter(t => !sectors[t]);
    if (need.length === 0) return;
    Promise.all(need.map(async t => {
      try {
        const res = await authedFetch<Record<string, unknown>[]>(`/api/fmp/profile?symbol=${t}`);
        const s = Array.isArray(res) && res[0] ? String(res[0].sector ?? "") : "";
        return [t, s] as const;
      } catch { return [t, ""] as const; }
    })).then(pairs => {
      if (!alive) return;
      setSectors(prev => { const n = { ...prev }; for (const [t, s] of pairs) if (s) n[t] = s; return n; });
    });
    return () => { alive = false; };
  }, [tickers, sectors]);

  const exposure = useMemo(() => {
    const positions: Position[] = trades.map(t => {
      const tk = t.ticker.toUpperCase();
      const mark = marks[tk] ?? t.price;
      return {
        ticker: tk,
        value: mark * t.shares,
        sector: sectors[tk] ?? t.sector ?? null,
        theme: detectTheme(t.thesis) ?? sectors[tk] ?? t.sector ?? null,
      };
    });
    return computeExposure(positions);
  }, [trades, marks, sectors]);

  if (exposure.byPosition.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
      <div className="section-label">Exposure &amp; concentration</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", maxWidth: 560, lineHeight: 1.5 }}>
        How your open book is spread across names, sectors and themes — so concentration is seen before it&apos;s felt.
      </div>

      {/* Concentration tiles */}
      <div className="sr-grid-3" style={{ marginBottom: "var(--sr-sp-4)" }}>
        <div className="sr-tile">
          <div className="sr-tile-label">Positions</div>
          <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">{exposure.byPosition.length}</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">Effective bets (1/HHI)</div>
          <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">{exposure.effectiveNames.toFixed(1)}</div>
          <div className="sr-hint">Diversification, not raw count</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">Largest name</div>
          <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: exposure.topWeight > 0.25 ? "var(--sr-warn)" : "var(--sr-text)" }} className="num">
            {(exposure.topWeight * 100).toFixed(0)}%
          </div>
          <div className="sr-hint">{exposure.topName ?? "—"}</div>
        </div>
      </div>

      {/* Flags */}
      {exposure.flags.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-4)" }}>
          {exposure.flags.map((f, i) => (
            <div key={i} style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", fontSize: "var(--sr-t-xs)", lineHeight: 1.5, background: "color-mix(in srgb, var(--sr-warn) 9%, transparent)", color: "var(--sr-warn)", border: "1px solid color-mix(in srgb, var(--sr-warn) 22%, transparent)" }}>
              ⚠ {f}
            </div>
          ))}
        </div>
      )}

      <div className="sr-grid-2" style={{ gap: "var(--sr-sp-5)" }}>
        <div>
          <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>By sector</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {exposure.bySector.length ? exposure.bySector.map(b => <BarRow key={b.key} b={b} color="var(--sr-amber)" />) : <div className="sr-hint">Loading sectors…</div>}
          </div>
        </div>
        <div>
          <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>By theme</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {exposure.byTheme.length ? exposure.byTheme.map(b => <BarRow key={b.key} b={b} color="#8B5CF6" />) : <div className="sr-hint">Tag trades with a thesis to see themes.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
