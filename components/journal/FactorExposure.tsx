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
    if (positions.length < 2) { setError("Añade al menos 2 posiciones abiertas distintas."); return; }
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
        setError("Se necesitan al menos 2 nombres con 24+ meses de historial (y SPY).");
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
      if (!model) { setError("No se pudo ajustar el modelo (factores colineales o muestra corta)."); setLoading(false); return; }
      setRes({ model, names: usable.map((u) => u.t), weights, dropped });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fallo al construir la exposición por factor");
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
            Regresa los retornos de <strong>tu cartera</strong> sobre el mercado y las sorpresas macro. El sector dice
            de qué va cada empresa; el factor dice qué mueve tu dinero. No suelen coincidir.
          </div>
        </div>
        <button className="btn-primary" onClick={run} disabled={loading} style={{ flexShrink: 0, padding: "8px 14px", fontSize: "var(--sr-t-sm)" }}>
          {loading ? "Midiendo…" : "✦ Radiografiar"}
        </button>
      </div>

      {error && <div style={{ marginTop: "var(--sr-sp-2)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{error}</div>}

      {res && m && topLoading && (
        <div style={{ marginTop: "var(--sr-sp-3)" }}>
          {/* El titular */}
          <div style={{ padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${effectiveBets < 2 ? "var(--sr-warn)" : "var(--sr-pos)"} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${effectiveBets < 2 ? "var(--sr-warn)" : "var(--sr-pos)"} 24%, transparent)`, fontSize: "var(--sr-t-sm)", lineHeight: 1.6, marginBottom: "var(--sr-sp-3)" }}>
            Tienes <strong>{res.names.length} nombres</strong> y{" "}
            <strong className="num">{effectiveBets.toFixed(1)}</strong> apuestas efectivas independientes.{" "}
            {(topShareOfSystematic * 100).toFixed(0)}% de la varianza que los factores explican viene de{" "}
            <strong>{FACTOR_LABELS[topLoading.factor] ?? topLoading.factor}</strong>.
            {effectiveBets < 2 && <> Contar tickers no es diversificar: en la práctica esto es una sola posición.</>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
            <div className="sr-tile"><div className="sr-tile-label">R²</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{(m.rSquared * 100).toFixed(0)}%</div></div>
            <div className="sr-tile"><div className="sr-tile-label">Sistemático</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{(m.systematicShare * 100).toFixed(0)}%</div></div>
            <div className="sr-tile"><div className="sr-tile-label">Idiosincrático</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: "var(--sr-warn)" }}>{(m.idiosyncraticShare * 100).toFixed(0)}%</div></div>
            <div className="sr-tile"><div className="sr-tile-label">Meses</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{m.n}</div><div style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>{(m.n / m.k).toFixed(1)} por parámetro</div></div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="sr-table">
              <thead><tr>
                <th>Factor</th>
                <th style={{ textAlign: "right" }}>Beta</th>
                <th style={{ textAlign: "right" }}>t</th>
                <th style={{ textAlign: "right" }}>% varianza</th>
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
              <div style={{ fontWeight: 700, fontSize: "var(--sr-t-sm)", marginBottom: 4 }}>Tu cartera, en una frase</div>
              <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.6 }}>
                Una posición {explainLoadings(m, FACTOR_LABELS).join(" · ")}.
              </div>
            </div>
          )}

          <div className="section-label" style={{ marginTop: "var(--sr-sp-4)" }}>Escenarios sobre la cartera</div>
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
            Pesos por valor de mercado actual, betas de una regresión de {m.n} meses. Las filas atenuadas tienen
            |t| &lt; 2 y no son distinguibles de cero. Los escenarios son lineales: no capturan que las betas suben
            justo en las crisis, que es cuando importan.
            {res.dropped.length > 0 && <div style={{ marginTop: 4, color: "var(--sr-warn)" }}>⚠ Sin historial suficiente, excluidos del cálculo: {res.dropped.join(", ")}.</div>}
            {m.warnings.map((w, i) => <div key={i} style={{ marginTop: 4, color: "var(--sr-warn)" }}>⚠ {w}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
