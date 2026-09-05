"use client";
import { useMemo } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import type { MacroState } from "@/lib/types";
import { waccBridge, dcfMatrix, sectorComps } from "@/lib/valuation";

interface Props { data: StockData; macro: MacroState | null; }
type Row = Record<string, unknown>;
const n = (v: unknown): number | null => { const x = Number(v); return isFinite(x) ? x : null; };
const pick = (r: Row | undefined, ...keys: string[]): number | null => { if (!r) return null; for (const k of keys) { const v = n(r[k]); if (v != null) return v; } return null; };
const sumTTM = (arr: Row[], ...keys: string[]): number | null => {
  const s = arr.slice(0, 4); if (s.length < 4) return null;
  let sum = 0; for (const r of s) { const v = pick(r, ...keys); if (v == null) return null; sum += v; } return sum;
};
const money = (x: number | null): string => x == null ? "—" : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${x.toFixed(0)}`;

export default function ValuationLab({ data, macro }: Props) {
  const model = useMemo(() => {
    const inc = data.income ?? [], cf = data.cashFlow ?? [], bs0 = (data.balanceSheet ?? [])[0];
    const rev = sumTTM(inc, "revenue", "totalRevenue");
    const ni = sumTTM(inc, "netIncome");
    const ebit = sumTTM(inc, "operatingIncome", "ebit");
    const da = sumTTM(cf, "depreciationAndAmortization") ?? sumTTM(inc, "depreciationAndAmortization");
    const interest = sumTTM(inc, "interestExpense");
    const ocf = sumTTM(cf, "operatingCashFlow", "netCashProvidedByOperatingActivities");
    const capex = sumTTM(cf, "capitalExpenditure");
    const price = pick(data.quote as Row, "price");
    const marketCap = pick(data.quote as Row, "marketCap");
    const shares = marketCap != null && price ? marketCap / price : null;
    const ltdStd = (pick(bs0, "longTermDebt") ?? 0) + (pick(bs0, "shortTermDebt") ?? 0);
    const totalDebt = pick(bs0, "totalDebt") ?? (ltdStd > 0 ? ltdStd : null);
    const cash = pick(bs0, "cashAndCashEquivalents", "cashAndShortTermInvestments");
    const netDebt = totalDebt != null ? totalDebt - (cash ?? 0) : 0;
    const fcf = ocf != null && capex != null ? ocf + capex : null; // capex is negative in FMP
    const margin = fcf != null && rev ? fcf / rev : null;
    const beta = pick(data.technicals as Row, "beta");
    const rf = macro?.dgs10 != null ? Number(macro.dgs10) : null;
    const eps = ni != null && shares ? ni / shares : null;
    const ebitda = ebit != null && da != null ? ebit + da : ebit;
    const sector = String((data.profile as Row)?.sector ?? "") || null;

    const wb = waccBridge({ rf, beta, marketCap, totalDebt, interestExpense: interest });
    const baseW = wb ? wb.wacc : 9;
    const waccs = [-2, -1, 0, 1, 2].map((d) => Math.max(4, Math.round((baseW + d) * 10) / 10));
    const growths = [4, 8, 12, 16, 20];
    const dm = rev != null && margin != null && shares != null
      ? dcfMatrix({ revenueTTM: rev, fcfMarginTTM: margin, netDebt, sharesOut: shares }, waccs, growths) : null;
    const comps = sectorComps({ sector, eps, ebitda, netDebt, sharesOut: shares });
    return { wb, dm, comps, price, baseW };
  }, [data, macro]);

  const { wb, dm, comps, price } = model;
  if (!wb && !dm && !comps) return null;
  const cellColor = (v: number | null): string =>
    v == null || price == null ? "var(--sr-text-3)" : v > price * 1.15 ? "var(--sr-pos)" : v < price * 0.85 ? "var(--sr-neg)" : "var(--sr-text-2)";

  return (
    <div className="card" style={{ marginTop: "var(--sr-sp-5)" }}>
      <div className="section-label">Valuation lab</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", maxWidth: 620, lineHeight: 1.5 }}>
        Puente WACC, matriz de sensibilidad del DCF y rango por comparables sectoriales. {price != null ? `Precio actual $${price.toFixed(2)}.` : ""}
      </div>

      {/* WACC bridge */}
      {wb && (
        <div className="sr-grid-4" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div className="sr-tile"><div className="sr-tile-label">Coste de equity (CAPM)</div><div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num">{wb.costOfEquity.toFixed(2)}%</div></div>
          <div className="sr-tile"><div className="sr-tile-label">Coste de deuda (post-tax)</div><div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num">{wb.costOfDebtAfterTax.toFixed(2)}%</div></div>
          <div className="sr-tile"><div className="sr-tile-label">Estructura E / D</div><div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num">{(wb.weightEquity * 100).toFixed(0)}/{(wb.weightDebt * 100).toFixed(0)}</div></div>
          <div className="sr-tile"><div className="sr-tile-label">WACC</div><div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 800, color: "var(--sr-amber)" }} className="num">{wb.wacc.toFixed(2)}%</div></div>
        </div>
      )}

      {/* DCF sensitivity matrix */}
      {dm && (
        <div style={{ marginBottom: "var(--sr-sp-4)", overflowX: "auto" }}>
          <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>DCF fair value / acción · WACC (filas) × crecimiento Y1-5 (columnas)</div>
          <table className="sr-table">
            <thead><tr><th>WACC \ g</th>{dm.growths.map((g) => <th key={g} style={{ textAlign: "right" }}>{g}%</th>)}</tr></thead>
            <tbody>
              {dm.grid.map((row, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }} className="num">{dm.waccs[i]}%</td>
                  {row.map((v, j) => <td key={j} style={{ textAlign: "right", fontWeight: 600, color: cellColor(v) }} className="num">{v == null ? "—" : `$${v.toFixed(0)}`}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>Verde = por encima del precio (infravalorado a ese escenario) · rojo = por debajo.</div>
        </div>
      )}

      {/* Comps */}
      {comps && (comps.peBased != null || comps.evBased != null) && (
        <div className="sr-grid-3">
          <div className="sr-tile"><div className="sr-tile-label">Comps P/E sector {comps.sectorPe ?? "—"}×</div><div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: cellColor(comps.peBased) }} className="num">{comps.peBased != null ? `$${comps.peBased.toFixed(2)}` : "—"}</div></div>
          <div className="sr-tile"><div className="sr-tile-label">Comps EV/EBITDA {comps.sectorEv ?? "—"}×</div><div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: cellColor(comps.evBased) }} className="num">{comps.evBased != null ? `$${comps.evBased.toFixed(2)}` : "—"}</div></div>
          <div className="sr-tile"><div className="sr-tile-label">Rango comps</div><div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700 }} className="num">{money(comps.low)}–{money(comps.high)}</div><div className="sr-hint">medio {money(comps.mid)}</div></div>
        </div>
      )}
    </div>
  );
}
