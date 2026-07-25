"use client";
import { useMemo } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import type { SubScores, SubScore } from "@/lib/scoring";
import { trendStage, detectBaseBreakout, type OHLCV } from "@/lib/technicalIndicators";
import { computeQuality, type QualityScores } from "@/lib/quality";

interface Props { subScores: SubScores | null; data: StockData | null; rf?: number | null; }

// ── Quality-inputs adapter: FMP/EDGAR statement fields → lib/quality inputs (null-safe) ──
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
  let s = 0, any = false;
  for (const r of slice) { const v = pick(r, ...keys); if (v == null) return null; s += v; any = true; }
  return any ? s : null;
};

function annualizedVol(history: Row[]): number | null {
  const closes = history.slice(0, 252).map(h => n(h.close)).filter((v): v is number => v != null && v > 0);
  if (closes.length < 30) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i - 1] / closes[i])); // newest-first
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

function buildQuality(data: StockData, rf: number | null): QualityScores {
  const inc = data.income ?? [], bs = data.balanceSheet ?? [], cf = data.cashFlow ?? [];
  const bs0 = bs[0], bs4 = bs[4];
  const sector = String((data.profile as Row)?.sector ?? "");
  const serviceOrFinancial = /financial|real estate|bank|insurance/i.test(sector);

  // TTM flows (current + prior-year)
  const revenue = sumTTM(inc, 0, "revenue", "totalRevenue");
  const revenuePrev = sumTTM(inc, 4, "revenue", "totalRevenue");
  const netIncome = sumTTM(inc, 0, "netIncome");
  const netIncomePrev = sumTTM(inc, 4, "netIncome");
  const ebit = sumTTM(inc, 0, "operatingIncome", "ebit");
  const pretax = sumTTM(inc, 0, "incomeBeforeTax", "pretaxIncome");
  const grossProfit = sumTTM(inc, 0, "grossProfit");
  const grossProfitPrev = sumTTM(inc, 4, "grossProfit");
  const sga = sumTTM(inc, 0, "sellingGeneralAndAdministrativeExpenses", "generalAndAdministrativeExpenses");
  const sgaPrev = sumTTM(inc, 4, "sellingGeneralAndAdministrativeExpenses", "generalAndAdministrativeExpenses");
  const depreciation = sumTTM(cf, 0, "depreciationAndAmortization") ?? sumTTM(inc, 0, "depreciationAndAmortization");
  const depreciationPrev = sumTTM(cf, 4, "depreciationAndAmortization") ?? sumTTM(inc, 4, "depreciationAndAmortization");
  const ocf = sumTTM(cf, 0, "operatingCashFlow", "netCashProvidedByOperatingActivities");
  const sharesTTM = sumTTM(inc, 0, "weightedAverageShsOutDil", "weightedAverageShsOut");
  const sharesPrev = sumTTM(inc, 4, "weightedAverageShsOutDil", "weightedAverageShsOut");

  // Balance-sheet instants (current + prior-year)
  const assets = pick(bs0, "totalAssets"), assetsPrev = pick(bs4, "totalAssets");
  const curA = pick(bs0, "totalCurrentAssets"), curAPrev = pick(bs4, "totalCurrentAssets");
  const curL = pick(bs0, "totalCurrentLiabilities"), curLPrev = pick(bs4, "totalCurrentLiabilities");
  const equity = pick(bs0, "totalStockholdersEquity", "totalEquity");
  const totLiab = pick(bs0, "totalLiabilities") ?? (assets != null && equity != null ? assets - equity : null);
  const retainedEarnings = pick(bs0, "retainedEarnings");
  const ltdStd = (pick(bs0, "longTermDebt") ?? 0) + (pick(bs0, "shortTermDebt") ?? 0);
  const totalDebt = pick(bs0, "totalDebt") ?? (ltdStd > 0 ? ltdStd : null);
  const totalDebtPrev = pick(bs4, "totalDebt");
  const ltd = pick(bs0, "longTermDebt"), ltdPrev = pick(bs4, "longTermDebt");
  const ppe = pick(bs0, "propertyPlantEquipmentNet"), ppePrev = pick(bs4, "propertyPlantEquipmentNet");
  const receivables = pick(bs0, "netReceivables"), receivablesPrev = pick(bs4, "netReceivables");
  const marketCap = pick(data.quote as Row, "marketCap");

  const workingCapital = curA != null && curL != null ? curA - curL : null;
  const currentRatio = curA != null && curL ? curA / curL : null;
  const currentRatioPrev = curAPrev != null && curLPrev ? curAPrev / curLPrev : null;

  return computeQuality({
    altman: { workingCapital, retainedEarnings, ebit, marketCap, bookEquity: equity, totalLiabilities: totLiab, sales: revenue, totalAssets: assets, serviceOrFinancial },
    accruals: { netIncome, operatingCashFlow: ocf, totalAssets: assets },
    dupont: { netIncome, sales: revenue, totalAssets: assets, totalEquity: equity, pretaxIncome: pretax, ebit },
    merton: { marketCap, totalDebt, equityVol: annualizedVol(data.history ?? []), riskFreePct: rf },
    piotroski: {
      roa: netIncome != null && assets ? netIncome / assets : null,
      roaPrev: netIncomePrev != null && assetsPrev ? netIncomePrev / assetsPrev : null,
      cfo: ocf, netIncome, totalAssets: assets,
      leverage: ltd != null && assets ? ltd / assets : null,
      leveragePrev: ltdPrev != null && assetsPrev ? ltdPrev / assetsPrev : null,
      currentRatio, currentRatioPrev,
      shares: sharesTTM, sharesPrev,
      grossMargin: grossProfit != null && revenue ? grossProfit / revenue : null,
      grossMarginPrev: grossProfitPrev != null && revenuePrev ? grossProfitPrev / revenuePrev : null,
      assetTurnover: revenue != null && assets ? revenue / assets : null,
      assetTurnoverPrev: revenuePrev != null && assetsPrev ? revenuePrev / assetsPrev : null,
    },
    beneish: {
      receivables, receivablesPrev, sales: revenue, salesPrev: revenuePrev,
      grossProfit, grossProfitPrev, totalAssets: assets, totalAssetsPrev: assetsPrev,
      currentAssets: curA, currentAssetsPrev: curAPrev, ppe, ppePrev,
      depreciation, depreciationPrev, sga, sgaPrev, totalDebt, totalDebtPrev,
      netIncome, operatingCashFlow: ocf,
    },
  });
}

const STAGE_META: Record<number, { color: string; blurb: string }> = {
  1: { color: "var(--sr-text-2)", blurb: "Sideways base — sellers exhausted, trend not yet up." },
  2: { color: "var(--sr-pos)",    blurb: "Advancing above a rising 150-day line — trend intact." },
  3: { color: "var(--sr-warn)",   blurb: "Extended above a flattening line — momentum fading." },
  4: { color: "var(--sr-neg)",    blurb: "Declining below a falling 150-day line — trend down." },
};

function toOHLCV(history: Record<string, unknown>[]): OHLCV[] {
  // history is newest-first from FMP → reverse to oldest→newest, keep ~1y.
  return history
    .slice(0, 260)
    .map(h => ({ open: Number(h.open), high: Number(h.high), low: Number(h.low), close: Number(h.close), volume: Number(h.volume) }))
    .filter(b => isFinite(b.close) && isFinite(b.high) && isFinite(b.low))
    .reverse();
}

function scoreColor(s: number): string {
  return s >= 7 ? "var(--sr-pos)" : s >= 4 ? "var(--sr-amber)" : "var(--sr-neg)";
}

function Gauge({ title, sub }: { title: string; sub: SubScore | null }) {
  if (!sub) return (
    <div className="sr-tile">
      <div className="sr-tile-label">{title}</div>
      <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: "var(--sr-text-3)" }}>—</div>
      <div className="sr-hint">Not enough data</div>
    </div>
  );
  const col = scoreColor(sub.score);
  return (
    <div className="sr-tile">
      <div className="sr-tile-label">{title}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: col }} className="num">{sub.score.toFixed(1)}</span>
        <span className="sr-hint">/ 10</span>
      </div>
      <div style={{ height: 6, background: "var(--sr-surface-3)", borderRadius: 3, overflow: "hidden", margin: "6px 0 8px" }}>
        <div style={{ height: "100%", width: `${sub.score * 10}%`, background: col, borderRadius: 3 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {sub.factors.map(f => (
          <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 34, height: 3, borderRadius: 2, background: "var(--sr-surface-3)", position: "relative", flexShrink: 0 }}>
              <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.round(f.strength * 100)}%`, background: scoreColor(f.strength * 10), borderRadius: 2 }} />
            </span>
            <span className="sr-hint">{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ZBAND_COLOR: Record<string, string> = { safe: "var(--sr-pos)", grey: "var(--sr-warn)", distress: "var(--sr-neg)" };

export default function StockSignals({ subScores, data, rf }: Props) {
  const ohlcv = useMemo(() => toOHLCV(data?.history ?? []), [data]);
  const stage = useMemo(() => (ohlcv.length >= 30 ? trendStage(ohlcv) : null), [ohlcv]);
  const bb = useMemo(() => (ohlcv.length >= 31 ? detectBaseBreakout(ohlcv) : null), [ohlcv]);
  const quality = useMemo(() => (data ? buildQuality(data, rf ?? null) : null), [data, rf]);
  const price = ohlcv.length ? ohlcv[ohlcv.length - 1].close : null;
  const hasQuality = quality && (quality.altman || quality.accruals || quality.dupont || quality.merton || quality.piotroski || quality.beneish);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-5)" }}>
      {/* Quality & solvency (Fase 1) */}
      {hasQuality && (
        <div className="card">
          <div className="section-label">Calidad &amp; solvencia</div>
          <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", maxWidth: 620, lineHeight: 1.5 }}>
            Distress, calidad de beneficio, descomposición del ROE y riesgo de crédito — todo de los estados financieros.
            Se muestran como contexto; no mueven el Scora Score hasta validar su poder predictivo.
          </div>
          <div className="sr-grid-3">
            {quality.altman && (
              <div className="sr-tile">
                <div className="sr-tile-label">Altman {quality.altman.model} · distress</div>
                <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: ZBAND_COLOR[quality.altman.band] }} className="num">{quality.altman.z.toFixed(2)}</div>
                <div className="sr-hint" style={{ color: ZBAND_COLOR[quality.altman.band] }}>{quality.altman.band === "safe" ? "Zona segura" : quality.altman.band === "grey" ? "Zona gris" : "Zona de distress"}</div>
              </div>
            )}
            {quality.merton && (
              <div className="sr-tile">
                <div className="sr-tile-label">Prob. de impago (1a)</div>
                <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: quality.merton.pd < 0.02 ? "var(--sr-pos)" : quality.merton.pd < 0.10 ? "var(--sr-warn)" : "var(--sr-neg)" }} className="num">{(quality.merton.pd * 100).toFixed(2)}%</div>
                <div className="sr-hint">DtD {quality.merton.distanceToDefault.toFixed(1)} · Merton/KMV</div>
              </div>
            )}
            {quality.accruals && (
              <div className="sr-tile">
                <div className="sr-tile-label">Calidad de beneficio</div>
                <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: quality.accruals.quality === "high" ? "var(--sr-pos)" : quality.accruals.quality === "medium" ? "var(--sr-warn)" : "var(--sr-neg)" }}>
                  {quality.accruals.quality === "high" ? "Alta" : quality.accruals.quality === "medium" ? "Media" : "Baja"}
                </div>
                <div className="sr-hint">Accruals {(quality.accruals.ratio * 100).toFixed(1)}%</div>
              </div>
            )}
            {quality.piotroski && (
              <div className="sr-tile">
                <div className="sr-tile-label">Piotroski F</div>
                <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: quality.piotroski.score / quality.piotroski.max >= 0.7 ? "var(--sr-pos)" : quality.piotroski.score / quality.piotroski.max >= 0.45 ? "var(--sr-warn)" : "var(--sr-neg)" }} className="num">
                  {quality.piotroski.score}<span className="sr-hint">/{quality.piotroski.max}</span>
                </div>
                <div className="sr-hint">Fortaleza fundamental</div>
              </div>
            )}
            {quality.beneish && (
              <div className="sr-tile">
                <div className="sr-tile-label">Beneish M · manipulación</div>
                <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: quality.beneish.flag === "unlikely" ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">{quality.beneish.m.toFixed(2)}</div>
                <div className="sr-hint" style={{ color: quality.beneish.flag === "unlikely" ? "var(--sr-pos)" : "var(--sr-neg)" }}>{quality.beneish.flag === "unlikely" ? "Sin señal" : "⚠ Posible manipulación"}</div>
              </div>
            )}
            {quality.dupont && (
              <div className="sr-tile">
                <div className="sr-tile-label">DuPont · ROE {(quality.dupont.roe3 * 100).toFixed(1)}%</div>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.6, marginTop: 2 }}>
                  Margen {(quality.dupont.netMargin * 100).toFixed(1)}% · Rotación {quality.dupont.assetTurnover.toFixed(2)}× · Apal. {quality.dupont.equityMultiplier.toFixed(2)}×
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quality sub-scores */}
      <div className="card">
        <div className="section-label">Quality sub-scores</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", maxWidth: 560, lineHeight: 1.5 }}>
          Two plain 0-10 gauges drawn from the same fundamentals the Scora Score uses — the durability of the
          business and the quality of its cash generation.
        </div>
        <div className="sr-grid-2">
          <Gauge title="Moat" sub={subScores?.moat ?? null} />
          <Gauge title="Cash-flow quality" sub={subScores?.cashFlow ?? null} />
        </div>
      </div>

      {/* Trend layer */}
      <div className="card">
        <div className="section-label">Trend &amp; entry</div>
        {!stage ? (
          <div className="sr-hint">Not enough price history for a trend read.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-4)" }}>
            {/* Stage */}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-4)", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {[1, 2, 3, 4].map(s => (
                  <span key={s} title={STAGE_META[s].blurb} style={{
                    width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "var(--sr-t-xs)", fontWeight: 800,
                    background: s === stage.stage ? STAGE_META[s].color : "var(--sr-surface-3)",
                    color: s === stage.stage ? "var(--sr-bg)" : "var(--sr-text-3)",
                    border: s === stage.stage ? "none" : "1px solid var(--sr-border)",
                  }}>{s}</span>
                ))}
              </div>
              <div>
                <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 800, color: STAGE_META[stage.stage].color }}>
                  Stage {stage.stage} · {stage.label}
                </div>
                <div className="sr-hint" style={{ maxWidth: 420, lineHeight: 1.4 }}>{STAGE_META[stage.stage].blurb}</div>
              </div>
            </div>

            {/* 150-day line facts */}
            <div className="sr-grid-3">
              <div className="sr-tile">
                <div className="sr-tile-label">150-day MA</div>
                <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num">{stage.sma150 != null ? `$${stage.sma150.toFixed(2)}` : "—"}</div>
                <div className="sr-hint">{price != null && stage.sma150 != null ? (price > stage.sma150 ? "Price above" : "Price below") : ""}</div>
              </div>
              <div className="sr-tile">
                <div className="sr-tile-label">150-day slope (20d)</div>
                <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: stage.slopePct == null ? "var(--sr-text-3)" : stage.slopePct > 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
                  {stage.slopePct == null ? "—" : `${stage.slopePct > 0 ? "+" : ""}${stage.slopePct.toFixed(1)}%`}
                </div>
                <div className="sr-hint">Trend direction</div>
              </div>
              <div className="sr-tile">
                <div className="sr-tile-label">Base breakout</div>
                <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: bb?.status === "base-breakout" ? "var(--sr-pos)" : bb?.status === "in-base" ? "var(--sr-amber)" : "var(--sr-text-3)" }}>
                  {bb?.status === "base-breakout" ? "Breaking out" : bb?.status === "in-base" ? "In base" : "No base"}
                </div>
                <div className="sr-hint">
                  {bb?.volumeRatio != null ? `Vol ${bb.volumeRatio.toFixed(1)}× avg${bb.volumeConfirmed ? " ✓" : ""}` : "—"}
                </div>
              </div>
            </div>

            {bb?.status === "base-breakout" && (
              <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", fontSize: "var(--sr-t-xs)", lineHeight: 1.5,
                background: bb.volumeConfirmed && bb.aboveTrend ? "color-mix(in srgb, var(--sr-pos) 10%, transparent)" : "color-mix(in srgb, var(--sr-amber) 10%, transparent)",
                color: bb.volumeConfirmed && bb.aboveTrend ? "var(--sr-pos)" : "var(--sr-amber)" }}>
                {bb.volumeConfirmed && bb.aboveTrend
                  ? `Breakout above the base high${bb.baseHigh != null ? ` ($${bb.baseHigh.toFixed(2)})` : ""} on ${bb.volumeRatio?.toFixed(1)}× volume, price above the 150-day line — a confirmed setup.`
                  : `Price cleared the base high${bb.baseHigh != null ? ` ($${bb.baseHigh.toFixed(2)})` : ""} but ${!bb.volumeConfirmed ? "without a 2× volume expansion" : ""}${!bb.volumeConfirmed && !bb.aboveTrend ? " and " : ""}${!bb.aboveTrend ? "below the 150-day line" : ""} — unconfirmed.`}
              </div>
            )}
            <div className="sr-hint" style={{ lineHeight: 1.5 }}>
              Trend context, not a recommendation. Scora&apos;s directional call folds price, trend and macro together on the Research tab.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
