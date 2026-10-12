"use client";
import { useMemo } from "react";
import { computeGovernance, jensenFcfTest, shareholderYield } from "@/lib/governance";
import { accrualsRatio } from "@/lib/quality";
import Articulacion from "./Articulacion";
import { waccBridge } from "@/lib/valuation";
import type { StockData } from "@/app/stock/[ticker]/page";
import { t, tv } from "@/lib/i18n/cliente";
import Trans from "@/components/Trans";

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
/** Nombre en pantalla de cada banda (la clave interna sigue en español). */
const BAND_LABEL: Record<string, string> = { baja: "Low", moderada: "Moderate", alta: "High", severa: "Severe" };

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
        <div className="section-label">{t(`Agency cost · Jensen & Meckling (1976) · ${ticker}`)}</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55, maxWidth: 640 }}>
          <Trans text={"When the people deciding aren't the people putting up the money, agency costs appear: monitoring, bonding and residual loss. The question that sums up the most-cited paper in corporate finance is simple:<s1> whose money is being spent, and for whose benefit?</s1>"} s1={(c) => <strong>{c}</strong>} />
        </div>

        {!g ? (
          <div className="sr-hint">{t("Not enough financial statements to measure the agency cost.")}</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-3)" }}>
              <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: BAND_COLOR[g.band] }}>
                {g.agencyCost.toFixed(0)}<span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}>/100</span>
              </div>
              <div style={{ fontWeight: 700, color: BAND_COLOR[g.band] }}>{t(BAND_LABEL[g.band] ?? g.band)} {" "}{t("friction")}</div>
              <div className="sr-hint">{t(`higher = worse for shareholders · ${g.covered} of 6 signals`)}</div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="sr-table">
                <thead><tr>
                  <th>{t("Signal")}</th>
                  <th style={{ textAlign: "right" }}>{t("Value")}</th>
                  <th style={{ textAlign: "right" }}>{t("Cost")}</th>
                  <th>{t("What it measures")}</th>
                </tr></thead>
                <tbody>
                  {g.components.map((c) => (
                    <tr key={c.key}>
                      <td style={{ fontWeight: 600 }}>{tv(c.label)}</td>
                      <td style={{ textAlign: "right" }} className="num">
                        {c.key === "insiderAlignment" ? `${(c.raw * 100).toFixed(1)}%` : c.key === "accruals" ? c.raw.toFixed(3) : `${c.raw.toFixed(1)}%`}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: c.score >= 60 ? "var(--sr-neg)" : c.score >= 35 ? "var(--sr-warn)" : "var(--sr-pos)" }} className="num">{c.score.toFixed(0)}</td>
                      <td className="sr-hint" style={{ lineHeight: 1.45 }}>{tv(c.note)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: "var(--sr-sp-3)" }}>
              {g.readings.map((r, i) => <div key={i} className="sr-hint" style={{ lineHeight: 1.6, marginBottom: 3 }}>{t(r)}</div>)}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="section-label">{t("Free cash flow test · Jensen (1986)")}</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55, maxWidth: 640 }}>
          <Trans text={"The FCF hypothesis: a manager with plenty of cash and no good projects builds an empire instead of paying it out. Hence the paper's counterintuitive conclusion — <s1>debt disciplines</s1>, because it commits future cash and takes away discretion."} s1={(c) => <strong>{c}</strong>} /></div>

        {!jensen ? (
          <div className="sr-hint">{t("FCF margin, ROIC or WACC is missing, so the test can't run.")}</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
              <div className="sr-tile">
                <div className="sr-tile-label">{t("ROIC − WACC spread")}</div>
                <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: (jensen.spread ?? 0) >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }}>
                  {jensen.spread == null ? "—" : t(`${jensen.spread >= 0 ? "+" : ""}${jensen.spread.toFixed(1)} pp`)}
                </div>
              </div>
              <div className="sr-tile">
                <div className="sr-tile-label">{t("Shareholder yield")}</div>
                <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{totalYield == null ? "—" : `${totalYield.toFixed(2)}%`}</div>
                <div style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>{t("dividends + buybacks − issuance")}</div>
              </div>
              <div className="sr-tile">
                <div className="sr-tile-label">{t("Empire building")}</div>
                <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: jensen.empireBuilding ? "var(--sr-neg)" : "var(--sr-pos)" }}>
                  {jensen.empireBuilding ? "YES" : "No"}
                </div>
              </div>
            </div>
            <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${jensen.empireBuilding ? "var(--sr-neg)" : "var(--sr-pos)"} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${jensen.empireBuilding ? "var(--sr-neg)" : "var(--sr-pos)"} 22%, transparent)`, fontSize: "var(--sr-t-xs)", lineHeight: 1.6 }}>
              {tv(jensen.reading)}
            </div>
          </>
        )}

        <div className="sr-hint" style={{ marginTop: "var(--sr-sp-3)", lineHeight: 1.6 }}>
          <Trans text={"These signals <s1>do not feed the Scora Score</s1>. Net issuance (Pontiff & Woodgate 2008) and asset growth (Cooper, Gulen & Schill 2008) have documented IC in the literature, so they deserve to be measured in the harness — measured, not assumed. Until they pass the out-of-sample gate they are context."} s1={(c) => <strong>{c}</strong>} /></div>
      </div>
      <Articulacion data={data} />
    </div>
  );
}
