"use client";
import { useCallback, useState } from "react";
import { authedFetch } from "@/lib/proxy";
import {
  fitFactorModel, portfolioReturns, scenarioImpact, explainLoadings, type FactorModel,
} from "@/lib/factorModel";
import {
  FACTOR_LABELS, SCENARIOS, fromHistory, monthlyCloses, pctReturns, fetchMacroInnovations,
} from "@/lib/factorData";

interface Position { ticker: string; value: number }
interface Props { positions: Position[] }

interface Result {
  model: FactorModel;
  names: string[];
  weights: number[];
  dropped: string[];
}

/**
 * Rayos X de factores de la CARTERA — la pieza que convierte `lib/exposure.ts` (concentración
 * por sector) en concentración por FACTOR.
 *
 * El punto: puedes tener ocho nombres de ocho sectores distintos y una sola apuesta. La
 * diversificación de Markowitz opera sobre covarianzas, no sobre el número de tickers, y lo
 * que hace que covaríen son los factores macro. Esto lo mide en vez de suponerlo.
 */
export default function FactorExposure({ positions }: Props) {
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    if (positions.length < 2) { setError("Add at least 2 different open positions."); return; }
    setLoading(true); setError(""); setRes(null);
    try {
      const uniq = new Map<string, number>();
      for (const p of positions) {
        if (!(p.value > 0)) continue;
        uniq.set(p.ticker.toUpperCase(), (uniq.get(p.ticker.toUpperCase()) ?? 0) + p.value);
      }
      const tickers = [...uniq.keys()];

      const histories = await Promise.all(tickers.map(async (t) => {
        try {
          const r = await authedFetch<Record<string, unknown>[]>(`/api/fmp/historical-price-eod/full?symbol=${t}`);
          return { t, closes: monthlyCloses(fromHistory(Array.isArray(r) ? r : [])) };
        } catch { return { t, closes: [] as { date: string; close: number }[] }; }
      }));
      const spyRaw = await authedFetch<Record<string, unknown>[]>(`/api/fmp/historical-price-eod/full?symbol=SPY`);
      const spy = monthlyCloses(fromHistory(Array.isArray(spyRaw) ? spyRaw : []));

      // Un nombre sin 24 meses se DESCARTA y se avisa: rellenar huecos inventaría datos.
      const usable = histories.filter((h) => h.closes.length >= 25);
      const dropped = histories.filter((h) => h.closes.length < 25).map((h) => h.t);
      if (usable.length < 2 || spy.length < 25) {
        setError("At least 2 names with 24+ months of history (and SPY) are needed.");
        setLoading(false); return;
      }

      const total = usable.reduce((s, u) => s + (uniq.get(u.t) ?? 0), 0);
      const weights = usable.map((u) => (uniq.get(u.t) ?? 0) / total);
      const assetReturns = usable.map((u) => pctReturns(u.closes));
      const y = portfolioReturns(weights, assetReturns);

      const start = usable[0].closes[0].date.slice(0, 10);
      const { factors: macro } = await fetchMacroInnovations(start);
      const factors: Record<string, number[]> = { market: pctReturns(spy), ...macro };

      const model = fitFactorModel(y, factors);
      if (!model) { setError("The model couldn't be fitted (collinear factors or too short a sample)."); setLoading(false); return; }
      setRes({ model, names: usable.map((u) => u.t), weights, dropped });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the factor exposure");
    }
    setLoading(false);
  }, [positions]);

  const m = res?.model;
  // Concentración por factor: cuánto de la varianza EXPLICADA se debe al factor dominante.
  // Es el equivalente del HHI de exposure.ts, pero sobre factores en vez de sectores.
  const shares = m ? m.loadings.map((l) => Math.abs(l.varianceShare)) : [];
  const sysTotal = shares.reduce((s, x) => s + x, 0);
  const topLoading = m && m.loadings.length
    ? [...m.loadings].sort((a, b) => Math.abs(b.varianceShare) - Math.abs(a.varianceShare))[0]
    : null;
  const topShareOfSystematic = topLoading && sysTotal > 0 ? Math.abs(topLoading.varianceShare) / sysTotal : 0;
  // 1/HHI sobre las cuotas normalizadas = número EFECTIVO de apuestas independientes.
  const hhi = sysTotal > 0 ? shares.reduce((s, x) => s + (x / sysTotal) ** 2, 0) : 0;
  const effectiveBets = hhi > 0 ? 1 / hhi : 0;

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>Factor X-ray · APT (Ross 1976)</div>
          <div className="sr-hint" style={{ maxWidth: 520, lineHeight: 1.5 }}>
            Regresses <strong>your portfolio&apos;s</strong> returns on the market and on macro surprises. The sector says
            what each company does; the factor says what moves your money. They rarely match.
          </div>
        </div>
        <button className="btn-primary" onClick={run} disabled={loading} style={{ flexShrink: 0, padding: "8px 14px", fontSize: "var(--sr-t-sm)" }}>
          {loading ? "Measuring…" : "✦ Run X-ray"}
        </button>
      </div>

      {error && <div style={{ marginTop: "var(--sr-sp-2)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{error}</div>}

      {res && m && topLoading && (
        <div style={{ marginTop: "var(--sr-sp-3)" }}>
          {/* El titular */}
          <div style={{ padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${effectiveBets < 2 ? "var(--sr-warn)" : "var(--sr-pos)"} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${effectiveBets < 2 ? "var(--sr-warn)" : "var(--sr-pos)"} 24%, transparent)`, fontSize: "var(--sr-t-sm)", lineHeight: 1.6, marginBottom: "var(--sr-sp-3)" }}>
            You hold <strong>{res.names.length} names</strong> and{" "}
            <strong className="num">{effectiveBets.toFixed(1)}</strong> effective independent bets.{" "}
            {(topShareOfSystematic * 100).toFixed(0)}% of the variance the factors explain comes from{" "}
            <strong>{FACTOR_LABELS[topLoading.factor] ?? topLoading.factor}</strong>.
            {effectiveBets < 2 && <> Counting tickers is not diversifying: in practice this is a single position.</>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
            <div className="sr-tile"><div className="sr-tile-label">R²</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{(m.rSquared * 100).toFixed(0)}%</div></div>
            <div className="sr-tile"><div className="sr-tile-label">Systematic</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{(m.systematicShare * 100).toFixed(0)}%</div></div>
            <div className="sr-tile"><div className="sr-tile-label">Idiosyncratic</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: "var(--sr-warn)" }}>{(m.idiosyncraticShare * 100).toFixed(0)}%</div></div>
            <div className="sr-tile"><div className="sr-tile-label">Months</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{m.n}</div><div style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>{(m.n / m.k).toFixed(1)} per parameter</div></div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="sr-table">
              <thead><tr>
                <th>Factor</th>
                <th style={{ textAlign: "right" }}>Beta</th>
                <th style={{ textAlign: "right" }}>t</th>
                <th style={{ textAlign: "right" }}>% of variance</th>
              </tr></thead>
              <tbody>
                {[...m.loadings].sort((a, b) => Math.abs(b.varianceShare) - Math.abs(a.varianceShare)).map((l) => (
                  <tr key={l.factor} style={{ opacity: l.significant ? 1 : 0.55 }}>
                    <td style={{ fontWeight: 600 }}>{FACTOR_LABELS[l.factor] ?? l.factor}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }} className="num">{l.beta >= 0 ? "+" : ""}{l.beta.toFixed(3)}</td>
                    <td style={{ textAlign: "right", color: l.significant ? "var(--sr-text)" : "var(--sr-text-3)" }} className="num">{l.tStat.toFixed(1)}</td>
                    <td style={{ textAlign: "right" }} className="num">{(l.varianceShare * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {explainLoadings(m, FACTOR_LABELS).length > 0 && (
            <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
              <div style={{ fontWeight: 700, fontSize: "var(--sr-t-sm)", marginBottom: 4 }}>Your portfolio, in one sentence</div>
              <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.6 }}>
                A position {explainLoadings(m, FACTOR_LABELS).join(" · ")}.
              </div>
            </div>
          )}

          <div className="section-label" style={{ marginTop: "var(--sr-sp-4)" }}>Portfolio scenarios</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--sr-sp-2)" }}>
            {SCENARIOS.map((s) => {
              if (!Object.keys(s.shocks).every((k) => m.loadings.some((l) => l.factor === k))) return null;
              const r = scenarioImpact(m, s.shocks);
              const tone = r.total >= 0 ? "var(--sr-pos)" : "var(--sr-neg)";
              return (
                <div key={s.label} style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${tone} 8%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${tone} 22%, transparent)` }}>
                  <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
                  <div className="num" style={{ fontSize: "var(--sr-t-base)", fontWeight: 800, color: tone }}>{r.total >= 0 ? "+" : ""}{r.total.toFixed(2)}%</div>
                </div>
              );
            })}
          </div>

          <div className="sr-hint" style={{ marginTop: "var(--sr-sp-3)", lineHeight: 1.6 }}>
            Weights by current market value, betas from a {m.n}-month regression. Dimmed rows have
            |t| &lt; 2 and are not distinguishable from zero. Scenarios are linear: they don&apos;t capture that betas rise
            precisely in crises, which is when they matter.
            {res.dropped.length > 0 && <div style={{ marginTop: 4, color: "var(--sr-warn)" }}>⚠ Not enough history, excluded from the calculation: {res.dropped.join(", ")}.</div>}
            {m.warnings.map((w, i) => <div key={i} style={{ marginTop: 4, color: "var(--sr-warn)" }}>⚠ {w}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
