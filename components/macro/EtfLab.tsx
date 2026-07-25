"use client";
import { useState } from "react";
import { ETFS, getEtf, overlap, cheaperAlternatives, etfSymbols, ETF_SNAPSHOT_ASOF, type EtfInfo } from "@/lib/etf";

const inputStyle: React.CSSProperties = {
  padding: "6px 10px", background: "var(--sr-surface)", border: "1px solid var(--sr-border)",
  borderRadius: "var(--sr-radius)", color: "var(--sr-text)", fontSize: "var(--sr-t-sm)", outline: "none", fontFamily: "inherit", minWidth: 200,
};

function bps(x: number): string { return `${x.toFixed(2)}%`; }

function Alternatives({ etf }: { etf: EtfInfo }) {
  const alts = cheaperAlternatives(etf.symbol);
  if (alts.length === 0) return <div className="sr-hint">{etf.symbol} is already the cheapest in {etf.category}.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {alts.map(a => (
        <div key={a.symbol} style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-2)", fontSize: "var(--sr-t-xs)" }}>
          <span style={{ fontWeight: 700, minWidth: 52 }} className="num">{a.symbol}</span>
          <span style={{ color: "var(--sr-text-3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
          <span style={{ color: "var(--sr-pos)", fontWeight: 700 }} className="num">{bps(a.expenseRatio)}</span>
          <span className="sr-hint">−{((etf.expenseRatio - a.expenseRatio) * 100).toFixed(0)} bps</span>
        </div>
      ))}
    </div>
  );
}

export default function EtfLab() {
  const [a, setA] = useState("SPY");
  const [b, setB] = useState("QQQ");
  const etfA = getEtf(a), etfB = getEtf(b);
  const ov = etfA && etfB ? overlap(etfA, etfB) : null;
  const cheaper = etfA && etfB ? (etfA.expenseRatio <= etfB.expenseRatio ? etfA : etfB) : null;
  const sorted = [...ETFS].sort((x, y) => x.symbol.localeCompare(y.symbol));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-5)" }}>
      <div className="card">
        <div className="section-label">ETF lab · overlap &amp; cost</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", maxWidth: 620, lineHeight: 1.5 }}>
          Compare two ETFs for expense ratio and top-holdings overlap — two funds that look different can hold the same
          names. Curated snapshot of the most widely-held funds ({ETF_SNAPSHOT_ASOF}).
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-3)", alignItems: "center", marginBottom: "var(--sr-sp-4)" }}>
          <select style={inputStyle} value={a} onChange={e => setA(e.target.value)}>
            {sorted.map(e => <option key={e.symbol} value={e.symbol}>{e.symbol} · {e.name}</option>)}
          </select>
          <span style={{ color: "var(--sr-text-3)", fontWeight: 700 }}>vs</span>
          <select style={inputStyle} value={b} onChange={e => setB(e.target.value)}>
            {sorted.map(e => <option key={e.symbol} value={e.symbol}>{e.symbol} · {e.name}</option>)}
          </select>
        </div>

        {etfA && etfB && (
          <>
            <div className="sr-grid-3" style={{ marginBottom: "var(--sr-sp-4)" }}>
              <div className="sr-tile">
                <div className="sr-tile-label">{etfA.symbol} expense</div>
                <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">{bps(etfA.expenseRatio)}</div>
                <div className="sr-hint">{etfA.category}</div>
              </div>
              <div className="sr-tile">
                <div className="sr-tile-label">{etfB.symbol} expense</div>
                <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">{bps(etfB.expenseRatio)}</div>
                <div className="sr-hint">{etfB.category}</div>
              </div>
              <div className="sr-tile">
                <div className="sr-tile-label">Top-holdings overlap</div>
                <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: !ov?.measurable ? "var(--sr-text-3)" : ov.overlapPct > 50 ? "var(--sr-warn)" : "var(--sr-text)" }} className="num">
                  {ov?.measurable ? `${ov.overlapPct.toFixed(0)}%` : "n/a"}
                </div>
                <div className="sr-hint">{ov?.measurable ? (ov.overlapPct > 50 ? "Heavily redundant" : ov.overlapPct > 20 ? "Partial overlap" : "Largely distinct") : "No holdings snapshot"}</div>
              </div>
            </div>

            {a === b && <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)" }}>Pick two different ETFs to compare.</div>}

            {ov?.measurable && ov.shared.length > 0 && (
              <div style={{ marginBottom: "var(--sr-sp-4)" }}>
                <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>Shared top holdings</div>
                <table className="sr-table">
                  <thead><tr><th>Holding</th><th style={{ textAlign: "right" }}>{etfA.symbol} wt</th><th style={{ textAlign: "right" }}>{etfB.symbol} wt</th><th style={{ textAlign: "right" }}>Overlap</th></tr></thead>
                  <tbody>
                    {ov.shared.map(s => (
                      <tr key={s.symbol}>
                        <td style={{ fontWeight: 700 }} className="num">{s.symbol}</td>
                        <td style={{ textAlign: "right" }} className="num">{s.weightA.toFixed(1)}%</td>
                        <td style={{ textAlign: "right" }} className="num">{s.weightB.toFixed(1)}%</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "var(--sr-amber)" }} className="num">{Math.min(s.weightA, s.weightB).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {cheaper && (
              <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", fontSize: "var(--sr-t-xs)", background: "color-mix(in srgb, var(--sr-pos) 9%, transparent)", color: "var(--sr-pos)", marginBottom: "var(--sr-sp-4)" }}>
                Cheaper of the two: <strong>{cheaper.symbol}</strong> at {bps(cheaper.expenseRatio)}.
              </div>
            )}

            <div className="sr-grid-2" style={{ gap: "var(--sr-sp-5)" }}>
              <div>
                <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>Cheaper alternatives to {etfA.symbol}</div>
                <Alternatives etf={etfA} />
              </div>
              <div>
                <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>Cheaper alternatives to {etfB.symbol}</div>
                <Alternatives etf={etfB} />
              </div>
            </div>
          </>
        )}

        <div className="sr-hint" style={{ marginTop: "var(--sr-sp-3)", lineHeight: 1.5 }}>
          Overlap is measured on the curated top-10 holdings — directional, not exact. Full-holdings overlap across all listed ETFs is a paid-data upgrade.
        </div>
      </div>
    </div>
  );
}
