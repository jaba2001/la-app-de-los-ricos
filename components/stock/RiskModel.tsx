"use client";
import { useCallback, useMemo, useState } from "react";
import { fitFactorModel, scenarioImpact, explainLoadings, type FactorModel } from "@/lib/factorModel";
import {
  FACTOR_LABELS, SCENARIOS, fromHistory, monthlyCloses, pctReturns, fetchMacroInnovations,
} from "@/lib/factorData";
import { amihudIlliquidity, arbitrageCost } from "@/lib/frictions";
import type { StockData } from "@/app/stock/[ticker]/page";

interface Props { ticker: string; data: StockData | null }

export default function RiskModel({ ticker, data }: Props) {
  const [model, setModel] = useState<FactorModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ran, setRan] = useState(false);

  // Fricciones de arbitraje: no dependen de la regresión salvo por la vol idiosincrática,
  // que sale del residuo. Se recalculan cuando llega el modelo.
  const frictions = useMemo(() => {
    if (!data) return null;
    const hist = fromHistory(data.history ?? []);
    const dollarVol = (data.history ?? [])
      .map((h) => Number(h.volume) * Number(h.close))
      .filter((v) => isFinite(v) && v > 0)
      .reverse();
    const closes = hist.map((h) => h.close);
    const amihud = closes.length > 20 && dollarVol.length > 20
      ? amihudIlliquidity(closes.slice(-250), dollarVol.slice(-250))
      : null;
    // El residuo del modelo es MENSUAL en %; se anualiza con sqrt(12).
    const idioAnnual = model ? model.residualVol * Math.sqrt(12) : null;
    return arbitrageCost({
      idiosyncraticVolAnnual: idioAnnual,
      shortInterestPctFloat: data.technicals?.shortPercent ?? data.finviz?.shortFloat ?? null,
      amihud,
      marketCap: Number(data.profile?.mktCap ?? data.metrics?.marketCap) || null,
    });
  }, [data, model]);

  const run = useCallback(async () => {
    if (!data) { setError("Datos del valor no cargados todavia."); return; }
    setLoading(true); setError(""); setRan(true);
    try {
      const stock = monthlyCloses(fromHistory(data.history ?? []));
      const spy = monthlyCloses(fromHistory(data.spyHistory ?? []));
      if (stock.length < 24 || spy.length < 24) {
        setError("Se necesitan al menos 24 meses de historial de precios para ajustar el modelo.");
        setLoading(false); return;
      }
      const start = stock[0].date.slice(0, 10);

      // Series macro de FRED, vía el módulo compartido con FactorExposure: mismos factores,
      // mismas transformaciones, misma alineación. Si derivaran, la beta de un nombre y la de
      // la cartera que lo contiene dejarían de ser comparables.
      const { factors: macro } = await fetchMacroInnovations(start);
      const factors: Record<string, number[]> = { market: pctReturns(spy), ...macro };

      const y = pctReturns(stock);
      const fitted = fitFactorModel(y, factors);
      if (!fitted) {
        setError("No se pudo ajustar el modelo (factores colineales o muestra insuficiente).");
        setModel(null);
      } else {
        setModel(fitted);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fallo al construir el modelo de riesgo");
    }
    setLoading(false);
  }, [data]);

  const readings = model ? explainLoadings(model, FACTOR_LABELS) : [];

  return (
    <div className="animate-fade-in">
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        <div className="sr-flex-between" style={{ gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
          <div>
            <div className="section-label" style={{ margin: 0 }}>Modelo de riesgo · CAPM + APT · {ticker}</div>
            <div className="sr-hint" style={{ maxWidth: 560, lineHeight: 1.55 }}>
              Regresión de los retornos mensuales sobre el mercado (Sharpe 1964) y las sorpresas macro de
              Chen-Roll-Ross (1986): prima de plazo, spread de crédito, inflación esperada, petróleo y dólar.
              Se regresa sobre <strong>innovaciones</strong>, no sobre niveles — un nivel no es un shock.
            </div>
          </div>
          <button className="btn-primary" onClick={run} disabled={loading} style={{ flexShrink: 0, padding: "8px 14px", fontSize: "var(--sr-t-sm)" }}>
            {loading ? "Ajustando…" : "✦ Ajustar modelo"}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{error}</div>
        )}

        {model && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--sr-sp-2)", marginTop: "var(--sr-sp-3)" }}>
              <div className="sr-tile"><div className="sr-tile-label">R²</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{(model.rSquared * 100).toFixed(0)}%</div></div>
              <div className="sr-tile"><div className="sr-tile-label">Riesgo sistemático</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{(model.systematicShare * 100).toFixed(0)}%</div></div>
              <div className="sr-tile"><div className="sr-tile-label">Riesgo idiosincrático</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: "var(--sr-warn)" }}>{(model.idiosyncraticShare * 100).toFixed(0)}%</div></div>
              <div className="sr-tile"><div className="sr-tile-label">Vol idiosincrática</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{(model.residualVol * Math.sqrt(12)).toFixed(1)}%</div><div style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>anualizada</div></div>
              <div className="sr-tile"><div className="sr-tile-label">Observaciones</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{model.n}</div><div style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>{(model.n / model.k).toFixed(1)} por parámetro</div></div>
            </div>

            <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-warn) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--sr-warn) 22%, transparent)", fontSize: "var(--sr-t-xs)", lineHeight: 1.6 }}>
              <strong>{(model.idiosyncraticShare * 100).toFixed(0)}% de la varianza de {ticker} es específica de la empresa.</strong>{" "}
              Según el CAPM ese riesgo es diversificable: desaparece en una cartera y por tanto <em>nadie te paga por
              soportarlo</em>. Es también, según Pontiff (2006), el mayor coste de mantener un arbitraje — por eso alimenta
              el cálculo de fricción de abajo.
            </div>

            <div style={{ overflowX: "auto", marginTop: "var(--sr-sp-3)" }}>
              <table className="sr-table">
                <thead><tr>
                  <th>Factor</th>
                  <th style={{ textAlign: "right" }}>Beta</th>
                  <th style={{ textAlign: "right" }}>Error est.</th>
                  <th style={{ textAlign: "right" }}>t</th>
                  <th style={{ textAlign: "right" }}>% varianza</th>
                </tr></thead>
                <tbody>
                  {model.loadings.map((l) => (
                    <tr key={l.factor} style={{ opacity: l.significant ? 1 : 0.55 }}>
                      <td style={{ fontWeight: 600 }}>{FACTOR_LABELS[l.factor] ?? l.factor}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }} className="num">{l.beta >= 0 ? "+" : ""}{l.beta.toFixed(3)}</td>
                      <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{l.stdError.toFixed(3)}</td>
                      <td style={{ textAlign: "right", color: l.significant ? "var(--sr-text)" : "var(--sr-text-3)" }} className="num">{l.tStat.toFixed(1)}</td>
                      <td style={{ textAlign: "right" }} className="num">{(l.varianceShare * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid var(--sr-border)" }}>
                    <td style={{ fontWeight: 600, color: "var(--sr-text-3)" }}>Alfa (mensual)</td>
                    <td style={{ textAlign: "right" }} className="num">{model.alpha >= 0 ? "+" : ""}{model.alpha.toFixed(3)}%</td>
                    <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{model.alphaStdError.toFixed(3)}</td>
                    <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{model.alphaTStat.toFixed(1)}</td>
                    <td style={{ textAlign: "right", color: "var(--sr-text-3)" }}>—</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)", lineHeight: 1.6 }}>
              Las filas atenuadas tienen |t| &lt; 2: <strong>no son distinguibles de cero</strong> y no deberían leerse como
              exposición. Publicar betas sin su t sería exactamente el pecado que este producto denuncia.
              {model.warnings.map((w, i) => <div key={i} style={{ marginTop: 4, color: "var(--sr-warn)" }}>⚠ {w}</div>)}
            </div>

            {readings.length > 0 && (
              <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
                <div style={{ fontWeight: 700, fontSize: "var(--sr-t-sm)", marginBottom: 4 }}>En una frase</div>
                <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.6 }}>
                  {ticker} se comporta como una posición {readings.join(" · ")}.
                </div>
              </div>
            )}

            <div className="section-label" style={{ marginTop: "var(--sr-sp-4)" }}>Escenarios</div>
            <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-2)" }}>
              Impacto lineal de un shock, con las betas de arriba. Aproximación de primer orden: no captura convexidad
              ni que las betas cambian de régimen.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--sr-sp-2)" }}>
              {SCENARIOS.map((s) => {
                const known = Object.keys(s.shocks).every((k) => model.loadings.some((l) => l.factor === k));
                if (!known) return null;
                const r = scenarioImpact(model, s.shocks);
                const tone = r.total >= 0 ? "var(--sr-pos)" : "var(--sr-neg)";
                return (
                  <div key={s.label} style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${tone} 8%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${tone} 22%, transparent)` }}>
                    <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
                    <div className="num" style={{ fontSize: "var(--sr-t-base)", fontWeight: 800, color: tone }}>{r.total >= 0 ? "+" : ""}{r.total.toFixed(2)}%</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!model && !loading && ran && !error && (
          <div className="sr-hint" style={{ marginTop: "var(--sr-sp-3)" }}>Sin modelo: revisa el historial disponible.</div>
        )}
      </div>

      {/* ── Fricciones de arbitraje (Shleifer & Vishny) ── */}
      <div className="card">
        <div className="section-label">Coste de arbitraje · Shleifer &amp; Vishny (1997)</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55 }}>
          Cuánto le costaría a un profesional corregir un error de precio en este nombre. Fricción alta significa que un
          descuento puede persistir mucho tiempo — o no cerrarse nunca. No es una señal de compra: es el contexto que
          dice cuánto puede tardar la convergencia.
          {!model && <> Ajusta el modelo de arriba para incorporar la volatilidad idiosincrática, que es el componente dominante.</>}
        </div>

        {!frictions ? (
          <div className="sr-hint">Sin datos suficientes para estimar el coste de arbitraje.</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-3)" }}>
              <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800 }}>{frictions.score.toFixed(0)}<span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}>/100</span></div>
              <div style={{ textTransform: "capitalize", fontWeight: 700 }}>fricción {frictions.band}</div>
              <div className="sr-hint">{frictions.covered} de 5 componentes</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
              {frictions.components.map((c) => (
                <div key={c.key} style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
                  <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.label}</div>
                  <div className="num" style={{ fontSize: "var(--sr-t-base)", fontWeight: 800 }}>{c.key === "size" ? `$${(c.raw / 1e9).toFixed(1)}B` : c.raw.toFixed(2)}</div>
                  <div className="num" style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>fricción {c.score.toFixed(0)}</div>
                </div>
              ))}
            </div>
            {frictions.readings.map((r, i) => (
              <div key={i} className="sr-hint" style={{ lineHeight: 1.6, marginBottom: 4 }}>{r}</div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
