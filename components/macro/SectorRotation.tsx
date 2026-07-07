"use client";
import { useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/proxy";
import { SECTORS, rankSectors, SECTOR_ROTATION_STATS as S } from "@/lib/sectors";

interface Close { date: string; close: number; }
function toCloses(raw: unknown): Close[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => { const o = r as Record<string, unknown>; return { date: String(o.date ?? "").slice(0, 10), close: Number(o.adjClose ?? o.close) }; })
    .filter((r) => r.date && !isNaN(r.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}
const shiftMonths = (d: string, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
function closeOnOrBefore(sorted: Close[], date: string): number | null {
  let lo = 0, hi = sorted.length - 1, ans: number | null = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (sorted[m].date <= date) { ans = sorted[m].close; lo = m + 1; } else hi = m - 1; }
  return ans;
}
function mom12_1(closes: Close[]): number | null {
  if (closes.length < 20) return null;
  const last = closes[closes.length - 1].date;
  const c1 = closeOnOrBefore(closes, shiftMonths(last, -1));
  const c12 = closeOnOrBefore(closes, shiftMonths(last, -12));
  return c1 != null && c12 != null && c12 > 0 ? (c1 / c12 - 1) * 100 : null;
}

export default function SectorRotation() {
  const [mom, setMom] = useState<Record<string, number | null> | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all(
      SECTORS.map((s) =>
        authedFetch<unknown>(`/api/fmp/historical-price-eod/full?symbol=${s.etf}`)
          .then((raw) => [s.etf, mom12_1(toCloses(raw))] as const)
          .catch(() => [s.etf, null] as const)
      )
    ).then((pairs) => { if (!alive) return; const m: Record<string, number | null> = {}; for (const [e, v] of pairs) m[e] = v; setMom(m); });
    return () => { alive = false; };
  }, []);

  const ranked = useMemo(() => (mom ? rankSectors(mom) : []), [mom]);
  const maxAbs = Math.max(1, ...ranked.map((r) => Math.abs(r.mom ?? 0)));

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>Sector rotation · Layer 3</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, maxWidth: 440, lineHeight: 1.5 }}>
            Within equities, 12-1m momentum favors some sectors. The top {S.topK} (▲) are what a dual-momentum rotation holds.
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Favored now</div>
          <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 800, color: "var(--sr-pos)" }}>{ranked.filter((r) => r.favored).map((r) => r.etf).join(" · ") || "—"}</div>
        </div>
      </div>

      {!mom ? (
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", padding: "var(--sr-sp-3) 0" }}>Computing sector momentum…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {ranked.map((r) => {
            const w = ((r.mom ?? 0) / maxAbs) * 50; // ±50% of the row width around center
            const pos = (r.mom ?? 0) >= 0;
            return (
              <div key={r.etf} style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", opacity: r.favored ? 1 : 0.72 }}>
                <div style={{ minWidth: 44, fontSize: "var(--sr-t-xs)", fontWeight: 700, color: r.favored ? "var(--sr-pos)" : "var(--sr-text-2)" }}>
                  {r.favored ? "▲ " : ""}{r.etf}
                </div>
                <div style={{ minWidth: 118, fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>{r.name}</div>
                <div style={{ flex: 1, position: "relative", height: 8, background: "var(--sr-surface-3)", borderRadius: 4 }}>
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--sr-border)" }} />
                  <div style={{ position: "absolute", top: 0, bottom: 0, width: `${Math.abs(w)}%`, background: pos ? "var(--sr-pos)" : "var(--sr-neg)", borderRadius: 4, ...(pos ? { left: "50%" } : { right: "50%" }) }} />
                </div>
                <div style={{ minWidth: 46, textAlign: "right", fontSize: "var(--sr-t-xs)", fontWeight: 700, color: pos ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
                  {r.mom == null ? "—" : (r.mom > 0 ? "+" : "") + r.mom.toFixed(0) + "%"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: "var(--sr-sp-3)", fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.5 }}>
        Backtest {S.period}: top-{S.topK} rotation Sharpe {S.strategy.sharpe} · drawdown {S.strategy.maxDrawdown}% — half of SPY&apos;s ({S.spy.maxDrawdown}%) and well above an equal-weight-sectors basket ({S.equalWeight.sharpe} / {S.equalWeight.maxDrawdown}%). A risk refinement within the equity sleeve, not a headline alpha.
      </div>
    </div>
  );
}
