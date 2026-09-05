"use client";
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/proxy";
import type { MacroState } from "@/lib/types";
import { METALS, netManagedMoney, wowChange, positioningRead, goldSilverRatio, type CotRow } from "@/lib/metals";

interface Props { macro: MacroState | null; loading?: boolean; }
type CotResponse = Record<string, { market: string; name: string; unit: string; rows: CotRow[] }>;
interface Quote { price: number | null; chg: number | null; }

const toneColor = (t: "pos" | "neg" | "neutral") => t === "pos" ? "var(--sr-pos)" : t === "neg" ? "var(--sr-neg)" : "var(--sr-text-2)";

export default function MetalsCockpit({ macro }: Props) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [cot, setCot] = useState<CotResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      Promise.all(METALS.map(async m => {
        try {
          const r = await authedFetch<Record<string, unknown>[]>(`/api/fmp/quote?symbol=${m.etf}`);
          const q = Array.isArray(r) ? r[0] : null;
          return [m.key, { price: q?.price != null ? Number(q.price) : null, chg: q?.changesPercentage != null ? Number(q.changesPercentage) : (q?.changePercentage != null ? Number(q.changePercentage) : null) }] as const;
        } catch { return [m.key, { price: null, chg: null }] as const; }
      })),
      authedFetch<CotResponse>(`/api/cot?market=all`).catch(() => null),
    ]).then(([qs, cotRes]) => {
      if (!alive) return;
      const qm: Record<string, Quote> = {}; for (const [k, v] of qs) qm[k] = v;
      setQuotes(qm); setCot(cotRes); setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const latest = (key: string): CotRow | null => {
    const rows = cot?.[key]?.rows ?? [];
    if (!rows.length) return null;
    return [...rows].sort((a, b) => a.date.localeCompare(b.date))[rows.length - 1];
  };

  const gld = quotes.gold?.price ?? null;
  const slv = quotes.silver?.price ?? null;
  const gsr = goldSilverRatio(gld, slv);
  const realYield = macro?.real_yield_10y != null ? Number(macro.real_yield_10y) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-5)" }}>
      <div className="card">
        <div className="section-label">Metals · price &amp; positioning</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", maxWidth: 620, lineHeight: 1.5 }}>
          Price from the liquid ETF proxy; positioning from the CFTC Commitments of Traders (weekly) — managed-money
          net long/short is the honest read of institutional flow.
        </div>

        {loading ? (
          <div className="sr-hint" style={{ padding: "var(--sr-sp-3) 0" }}>Loading metals…</div>
        ) : (
          <div className="sr-grid-2">
            {METALS.map(m => {
              const q = quotes[m.key];
              const row = latest(m.key);
              const net = row ? netManagedMoney(row) : null;
              const wow = wowChange(cot?.[m.key]?.rows ?? []);
              const read = positioningRead(row, wow);
              return (
                <div key={m.key} className="sr-tile">
                  <div className="sr-flex-between">
                    <div className="sr-tile-label" style={{ margin: 0 }}>{m.name} · {m.etf}</div>
                    {q?.chg != null && (
                      <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: q.chg >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
                        {q.chg >= 0 ? "+" : ""}{q.chg.toFixed(2)}%
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, margin: "2px 0 6px" }} className="num">
                    {q?.price != null ? `$${q.price.toFixed(2)}` : "—"}
                  </div>
                  <div style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: toneColor(read.tone), marginBottom: 4 }}>{read.label}</div>
                  <div className="sr-hint">
                    {net != null ? `Managed-money net ${net >= 0 ? "+" : ""}${net.toLocaleString()} contracts` : "No COT data"}
                    {wow != null ? ` · WoW ${wow >= 0 ? "+" : ""}${wow.toLocaleString()}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Cross-metal context */}
        <div className="sr-grid-3" style={{ marginTop: "var(--sr-sp-4)" }}>
          <div className="sr-tile">
            <div className="sr-tile-label">Gold / silver ratio</div>
            <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">{gsr != null ? gsr.toFixed(1) : "—"}</div>
            <div className="sr-hint">{gsr != null ? (gsr > 85 ? "Silver cheap vs gold" : gsr < 65 ? "Silver rich vs gold" : "Mid-range") : "Needs GLD + SLV"}</div>
          </div>
          <div className="sr-tile">
            <div className="sr-tile-label">Real 10-yr yield</div>
            <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: realYield == null ? "var(--sr-text-3)" : realYield < 1 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
              {realYield != null ? `${realYield.toFixed(2)}%` : "—"}
            </div>
            <div className="sr-hint">Gold&apos;s biggest macro driver</div>
          </div>
          <div className="sr-tile">
            <div className="sr-tile-label">Gold spot (FRED)</div>
            <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">{macro?.gold_price != null ? `$${Number(macro.gold_price).toFixed(0)}` : "—"}</div>
            <div className="sr-hint">Daily LBMA fix</div>
          </div>
        </div>

        <div className="sr-hint" style={{ marginTop: "var(--sr-sp-3)", lineHeight: 1.5 }}>
          Lower real yields lift gold (no coupon to compete with); a high gold/silver ratio historically favors silver. Warehouse &amp; lease-rate depth is a paid-data upgrade.
        </div>
      </div>
    </div>
  );
}
