"use client";
// ─────────────────────────────────────────────────────────────────────────────
// INTEGRIDAD CONTABLE en la ficha del valor.
//
// Aplica las cuatro identidades de `lib/articulacion.ts` a los estados financieros que la app
// ya descarga. Tiene un valor que el laboratorio no tiene: **la app y el laboratorio usan
// fuentes DISTINTAS** —aquí llegan de FMP a través de app/api/fmp, allí de EDGAR—, así que la
// misma comprobación sobre las dos es un contraste independiente. Si una fuente descuadra y
// la otra no, el problema es de la fuente y no de la empresa.
//
// No es una señal y no predice nada: dice si las cifras con las que se calculan los ratios de
// esta pantalla atan entre sí. Un valor con confianza baja no es una mala empresa; es una
// cuyos números no nos podemos creer.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from "react";
import { articular, TOLERANCIA, type IdComprobacion } from "@/lib/articulacion";
import type { StockData } from "@/app/stock/[ticker]/page";

type Row = Record<string, unknown>;
const n = (v: unknown): number | null => { const x = Number(v); return isFinite(x) && v !== null && v !== "" ? x : null; };
const pick = (r: Row | undefined, ...keys: string[]): number | null => {
  if (!r) return null;
  for (const k of keys) { const v = n(r[k]); if (v != null) return v; }
  return null;
};
/** Suma los cuatro trimestres más recientes. Devuelve null si no hay cuatro: media suma es
 *  peor que ninguna, porque parece un dato. */
const sumTTM = (arr: Row[], ...keys: string[]): number | null => {
  const s = arr.slice(0, 4);
  if (s.length < 4) return null;
  let t = 0;
  for (const r of s) { const v = pick(r, ...keys); if (v == null) return null; t += v; }
  return t;
};

const ETIQUETA: Record<IdComprobacion, string> = {
  balance: "Assets = Liabilities + Equity",
  caja: "Change in cash = sum of the three cash flows",
  patrimonio: "Equity = prior + net income − payouts",
  margen: "Gross profit = Revenue − Cost of revenue",
};

const EXPLICA: Record<IdComprobacion, string> = {
  balance: "The exact double-entry identity. Includes minority interest and temporary (mezzanine) equity, which sit outside permanent equity.",
  caja: "Operating + investing + financing, plus the FX effect on foreign-currency balances. Measured against total assets, not against itself: the change in cash over twelve months hovers around zero.",
  patrimonio: "A deliberately loose check (25%): between two fiscal years equity also moves with other comprehensive income, stock-based pay and conversions, which aren't in this sum.",
  margen: "Pure arithmetic when all three figures are present.",
};

/** Nombre en pantalla de la confianza (la clave de lib/articulacion.ts sigue en español). */
const CONFIANZA_LABEL: Record<string, string> = { alta: "High", media: "Medium", baja: "Low" };

export default function Articulacion({ data }: { data: StockData | null }) {
  const r = useMemo(() => {
    if (!data) return null;
    const inc = (data.income ?? []) as Row[];
    const bs = (data.balanceSheet ?? []) as Row[];
    const cf = (data.cashFlow ?? []) as Row[];
    if (!inc.length || !bs.length || !cf.length) return null;

    const b0 = bs[0], b4 = bs[4];
    return articular({
      assets: pick(b0, "totalAssets"),
      liabilities: pick(b0, "totalLiabilities"),
      equity: pick(b0, "totalStockholdersEquity", "totalEquity"),
      minorityInterest: pick(b0, "minorityInterest"),
      // FMP no separa el mezzanine en su esquema estándar; si algún día lo trae, entra aquí.
      temporaryEquity: null,

      deltaCashSinFx: sumTTM(cf, "netChangeInCash"),
      ocf: sumTTM(cf, "operatingCashFlow", "netCashProvidedByOperatingActivities"),
      cfi: sumTTM(cf, "netCashUsedForInvestingActivites", "netCashUsedForInvestingActivities"),
      cff: sumTTM(cf, "netCashUsedProvidedByFinancingActivities", "netCashProvidedByFinancingActivities"),
      fxCash: sumTTM(cf, "effectOfForexChangesOnCash"),
      escalaCaja: pick(b0, "totalAssets"),

      equityFin: pick(b0, "totalStockholdersEquity", "totalEquity"),
      equityPrev: pick(b4, "totalStockholdersEquity", "totalEquity"),
      netIncome: sumTTM(inc, "netIncome"),
      dividends: (() => { const d = sumTTM(cf, "dividendsPaid", "commonDividendsPaid"); return d == null ? null : Math.abs(d); })(),
      buybacks: (() => { const d = sumTTM(cf, "commonStockRepurchased", "commonStockRepurchase"); return d == null ? null : Math.abs(d); })(),

      revenue: sumTTM(inc, "revenue", "totalRevenue"),
      cost: sumTTM(inc, "costOfRevenue"),
      grossProfit: sumTTM(inc, "grossProfit"),
    });
  }, [data]);

  if (!r) return <p className="sr-hint">Not enough financial statements to check accounting integrity.</p>;

  const color = r.confianza === "alta" ? "var(--sr-pos)" : r.confianza === "media" ? "var(--sr-warn)" : "var(--sr-neg)";
  const resumen = r.comprobables === 0
    ? "No identity can be checked with the available data."
    : `${r.pasan} of ${r.comprobables} identities reconcile.`;

  return (
    <section className="card" style={{ marginTop: "var(--sr-sp-4)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-2)", flexWrap: "wrap" }}>
        <h3 style={{ fontSize: "var(--sr-t-md)", fontWeight: 700, margin: 0 }}>Accounting integrity</h3>
        <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color }}>{CONFIANZA_LABEL[r.confianza] ?? r.confianza} confidence</span>
        <span className="sr-hint" style={{ fontSize: "var(--sr-t-xs)" }}>{resumen}</span>
      </div>

      <p className="sr-hint" style={{ marginTop: "var(--sr-sp-2)", lineHeight: 1.7 }}>
        Double-entry bookkeeping forces these accounts to reconcile. When they don&apos;t, any ratio built on top
        is a credible, wrong number. <strong>It doesn&apos;t say whether the company is good</strong>: it says whether
        its figures hold together.
      </p>

      <div style={{ marginTop: "var(--sr-sp-3)", display: "grid", gap: "var(--sr-sp-2)" }}>
        {r.comprobaciones.map((c) => {
          const estado = c.ok === null ? "not checkable" : c.ok ? "reconciles" : "doesn't reconcile";
          const col = c.ok === null ? "var(--sr-text-2)" : c.ok ? "var(--sr-pos)" : "var(--sr-neg)";
          return (
            <div key={c.id} style={{ borderLeft: `3px solid ${col}`, paddingLeft: "var(--sr-sp-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--sr-sp-2)", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "var(--sr-t-sm)" }}>{ETIQUETA[c.id]}</strong>
                <span style={{ fontSize: "var(--sr-t-sm)", color: col, fontWeight: 700 }}>
                  {estado}
                  {c.desvio != null && c.ok === false ? ` · off by ${(c.desvio * 100).toFixed(1)}%` : ""}
                  {c.ok === true && c.desvio != null ? ` · ${(c.desvio * 100).toFixed(2)}%` : ""}
                </span>
              </div>
              <p className="sr-hint" style={{ margin: "2px 0 0", fontSize: "var(--sr-t-xs)", lineHeight: 1.6 }}>
                {c.ok === null ? c.motivo : EXPLICA[c.id]}
                {c.ok !== null ? ` Tolerance ${(TOLERANCIA[c.id] * 100).toFixed(0)}%.` : ""}
              </p>
            </div>
          );
        })}
      </div>

      <p className="sr-hint" style={{ marginTop: "var(--sr-sp-3)", fontSize: "var(--sr-t-xs)", lineHeight: 1.6 }}>
        <strong>&ldquo;Not checkable&rdquo; doesn&apos;t mean &ldquo;wrong&rdquo;.</strong> It means figures are missing or the available ones
        come from different period ends, and comparing two different snapshots doesn&apos;t detect a mismatch: it invents one.
      </p>
    </section>
  );
}
