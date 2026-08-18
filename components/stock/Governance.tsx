"use client";
import { useMemo } from "react";
import { computeGovernance, jensenFcfTest, shareholderYield } from "@/lib/governance";
import { accrualsRatio } from "@/lib/quality";
import { waccBridge } from "@/lib/valuation";
import type { StockData } from "@/app/stock/[ticker]/page";

interface Props { ticker: string; data: StockData | null; rf: number | null }

type Row = Record<string, unknown>;
const n = (v: unknown): number | null => { const x = Number(v); return isFinite(x) ? x : null; };
const pick = (r: Row | undefined, ...keys: string[]): number | null => {
  if (!r) return null;
  for (const k of keys) { const v = n(r[k]); if (v != null) return v; }
  return null;
};
const sumTTM = (arr: Row[], start: number, ...keys: string[]): number | null => {
  const slice = arr.slice(start, start + 4);
  if (slice.length < 4) return null;
  let s = 0;
  for (const r of slice) { const v = pick(r, ...keys); if (v == null) return null; s += v; }
  return s;
};
const growthPct = (now: number | null, prev: number | null): number | null =>
  now != null && prev != null && prev !== 0 ? ((now - prev) / Math.abs(prev)) * 100 : null;

const BAND_COLOR: Record<string, string> = {
  baja: "var(--sr-pos)", moderada: "var(--sr-text-2)", alta: "var(--sr-warn)", severa: "var(--sr-neg)",
};

export default function Governance({ ticker, data, rf }: Props) {
  const built = useMemo(() => {
    if (!data) return { governance: null, jensen: null, totalYield: null, wacc: null };
    const inc = data.income ?? [], bs = data.balanceSheet ?? [], cf = data.cashFlow ?? [];

    const revenue = sumTTM(inc, 0, "revenue", "totalRevenue");
    const netIncome = sumTTM(inc, 0, "netIncome");
    const ocf = sumTTM(cf, 0, "operatingCashFlow", "netCashProvidedByOperatingActivities");
    const capex = sumTTM(cf, 0, "capitalExpenditure", "investmentsInPropertyPlantAndEquipment");
    const sbc = sumTTM(cf, 0, "stockBasedCompensation");
    const divs = sumTTM(cf, 0, "dividendsPaid", "commonDividendsPaid");
    const buybacks = sumTTM(cf, 0, "commonStockRepurchased", "commonStockRepurchase");

    const shares = pick(inc[0], "weightedAverageShsOutDil", "weightedAverageShsOut");
    const sharesPrev = pick(inc[4], "weightedAverageShsOutDil", "weightedAverageShsOut");
    const totalAssets = pick(bs[0], "totalAssets");
    const totalAssetsPrev = pick(bs[4], "totalAssets");
    const marketCap = Number(data.profile?.mktCap ?? data.metrics?.marketCap) || null;

    const fcf = ocf != null && capex != null ? ocf - Math.abs(capex) : null;
    const netIssuancePct = growthPct(shares, sharesPrev);
    const assetGrowthPct = growthPct(totalAssets, totalAssetsPrev);
    const sbcToRevenuePct = sbc != null && revenue ? (Math.abs(sbc) / revenue) * 100 : null;
    const sbcToFcfPct = sbc != null && fcf && fcf > 0 ? (Math.abs(sbc) / fcf) * 100 : null;
    const acc = accrualsRatio(netIncome, ocf, totalAssets);

    const governance = computeGovernance({
      netIssuancePct,
      sbcToRevenuePct,
      sbcToFcfPct,
      assetGrowthPct,
      insiderOwn: data.finviz?.insiderOwn ?? null,
      accrualsRatio: acc ? acc.ratio : null,
    });

    // Jensen (1986): hace falta el coste de capital, y ya existe el puente CAPM.
    const wacc = waccBridge({
      rf, beta: data.technicals?.beta ?? null, marketCap,
      totalDebt: pick(bs[0], "totalDebt"),
      interestExpense: sumTTM(inc, 0, "interestExpense"),
    });
    const roicPct = n(data.metrics?.roic) != null ? (n(data.metrics!.roic) as number) * 100 : n(data.ratios?.returnOnCapitalEmployed) != null ? (n(data.ratios!.returnOnCapitalEmployed) as number) * 100 : null;
    const dividendYieldPct = divs != null && marketCap ? (Math.abs(divs) / marketCap) * 100 : null;
    const buybackYieldPct = buybacks != null && marketCap ? (Math.abs(buybacks) / marketCap) * 100 : null;

    const jensen = jensenFcfTest({
      fcfMarginPct: fcf != null && revenue ? (fcf / revenue) * 100 : null,
      roicPct,
      waccPct: wacc?.wacc ?? null,
      capexToRevenuePct: capex != null && revenue ? (Math.abs(capex) / revenue) * 100 : null,
      dividendYieldPct,
      buybackYieldPct,
    });

    const totalYield = shareholderYield(dividendYieldPct, buybackYieldPct, netIssuancePct);
    return { governance, jensen, totalYield, wacc };
  }, [data, rf]);

  const { governance: g, jensen, totalYield } = built;

  return (
    <div className="animate-fade-in">
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        <div className="section-label">Coste de agencia · Jensen &amp; Meckling (1976) · {ticker}</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55, maxWidth: 640 }}>
          Cuando quien decide no es quien pone el dinero aparecen costes de agencia: monitorización, fianza y pérdida
          residual. La pregunta que resume el paper más citado de las finanzas corporativas es simple:
          <strong> ¿de quién es el dinero que se está gastando, y en beneficio de quién?</strong>
        </div>

        {!g ? (
          <div className="sr-hint">Sin estados financieros suficientes para medir el coste de agencia.</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-3)" }}>
              <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: BAND_COLOR[g.band] }}>
                {g.agencyCost.toFixed(0)}<span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}>/100</span>
              </div>
              <div style={{ textTransform: "capitalize", fontWeight: 700, color: BAND_COLOR[g.band] }}>fricción {g.band}</div>
              <div className="sr-hint">mayor = peor para el accionista · {g.covered} de 6 señales</div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="sr-table">
                <thead><tr>
                  <th>Señal</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                  <th style={{ textAlign: "right" }}>Coste</th>
                  <th>Qué mide</th>
                </tr></thead>
                <tbody>
                  {g.components.map((c) => (
                    <tr key={c.key}>
                      <td style={{ fontWeight: 600 }}>{c.label}</td>
                      <td style={{ textAlign: "right" }} className="num">
                        {c.key === "insiderAlignment" ? `${(c.raw * 100).toFixed(1)}%` : c.key === "accruals" ? c.raw.toFixed(3) : `${c.raw.toFixed(1)}%`}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: c.score >= 60 ? "var(--sr-neg)" : c.score >= 35 ? "var(--sr-warn)" : "var(--sr-pos)" }} className="num">{c.score.toFixed(0)}</td>
                      <td className="sr-hint" style={{ lineHeight: 1.45 }}>{c.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: "var(--sr-sp-3)" }}>
              {g.readings.map((r, i) => <div key={i} className="sr-hint" style={{ lineHeight: 1.6, marginBottom: 3 }}>{r}</div>)}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="section-label">Test del flujo de caja libre · Jensen (1986)</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55, maxWidth: 640 }}>
          La hipótesis del FCF: el directivo con caja abundante y sin proyectos buenos construye imperio en vez de
          repartir. De ahí la conclusión contraintuitiva del paper — <strong>la deuda disciplina</strong>, porque
          compromete la caja futura y le quita discrecionalidad.
        </div>

        {!jensen ? (
          <div className="sr-hint">Faltan margen de FCF, ROIC o WACC para correr el test.</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
              <div className="sr-tile">
                <div className="sr-tile-label">Diferencial ROIC − WACC</div>
                <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: (jensen.spread ?? 0) >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }}>
                  {jensen.spread == null ? "—" : `${jensen.spread >= 0 ? "+" : ""}${jensen.spread.toFixed(1)} pp`}
                </div>
              </div>
              <div className="sr-tile">
                <div className="sr-tile-label">Rentabilidad al accionista</div>
                <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{totalYield == null ? "—" : `${totalYield.toFixed(2)}%`}</div>
                <div style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>dividendos + recompras − emisión</div>
              </div>
              <div className="sr-tile">
                <div className="sr-tile-label">Construcción de imperio</div>
                <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: jensen.empireBuilding ? "var(--sr-neg)" : "var(--sr-pos)" }}>
                  {jensen.empireBuilding ? "SÍ" : "No"}
                </div>
              </div>
            </div>
            <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${jensen.empireBuilding ? "var(--sr-neg)" : "var(--sr-pos)"} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${jensen.empireBuilding ? "var(--sr-neg)" : "var(--sr-pos)"} 22%, transparent)`, fontSize: "var(--sr-t-xs)", lineHeight: 1.6 }}>
              {jensen.reading}
            </div>
          </>
        )}

        <div className="sr-hint" style={{ marginTop: "var(--sr-sp-3)", lineHeight: 1.6 }}>
          Estas señales <strong>no entran en el Scora Score</strong>. La emisión neta (Pontiff &amp; Woodgate 2008) y el
          crecimiento de activos (Cooper, Gulen &amp; Schill 2008) tienen IC documentada en la literatura, así que merecen
          medirse en el harness — pero medirse, no suponerse. Hasta que pasen el gate fuera de muestra son contexto.
        </div>
      </div>
    </div>
  );
}
