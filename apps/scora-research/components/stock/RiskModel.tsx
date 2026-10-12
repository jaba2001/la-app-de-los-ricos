"use client";
import { useCallback, useMemo, useState } from "react";
import { fitFactorModel, scenarioImpact, explainLoadings, type FactorModel } from "@/lib/factorModel";
import {
  FACTOR_LABELS, SCENARIOS, fromHistory, monthlyCloses, pctReturns, fetchMacroInnovations,
} from "@/lib/factorData";
import { amihudIlliquidity, arbitrageCost } from "@/lib/frictions";
import type { StockData } from "@/app/stock/[ticker]/page";
import { t, tv } from "@/lib/i18n/cliente";
import Trans from "@/components/Trans";

interface Props { ticker: string; data: StockData | null }

/** Nombre en pantalla de cada banda de fricción (la clave interna sigue en español). */
const FRICCION_LABEL: Record<string, string> = { baja: "Low", media: "Medium", alta: "High", extrema: "Extreme" };

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
    if (!data) { setError(t("Stock data not loaded yet.")); return; }
    setLoading(true); setError(""); setRan(true);
    try {
      const stock = monthlyCloses(fromHistory(data.history ?? []));
      const spy = monthlyCloses(fromHistory(data.spyHistory ?? []));
      if (stock.length < 24 || spy.length < 24) {
        setError(t("At least 24 months of price history are needed to fit the model."));
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
        setError(t("The model couldn't be fitted (collinear factors or too small a sample)."));
        setModel(null);
      } else {
        setModel(fitted);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't build the risk model"));
    }
    setLoading(false);
  }, [data]);

  const readings = model ? explainLoadings(model, FACTOR_LABELS) : [];

  return (
    <div className="animate-fade-in">
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        <div className="sr-flex-between" style={{ gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
          <div>
            <div className="section-label" style={{ margin: 0 }}>{t(`Risk model · CAPM + APT · ${ticker}`)}</div>
            <div className="sr-hint" style={{ maxWidth: 560, lineHeight: 1.55 }}>
              <Trans text={"Regression of monthly returns on the market (Sharpe 1964) and the Chen-Roll-Ross (1986) macro surprises: term premium, credit spread, expected inflation, oil and the dollar. It regresses on <s1>innovations</s1>, not levels — a level is not a shock."} s1={(c) => <strong>{c}</strong>} /></div>
          </div>
          <button className="btn-primary" onClick={run} disabled={loading} style={{ flexShrink: 0, padding: "8px 14px", fontSize: "var(--sr-t-sm)" }}>
            {loading ? t("Fitting…") : t("✦ Fit model")}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{error}</div>
        )}

        {model && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--sr-sp-2)", marginTop: "var(--sr-sp-3)" }}>
              <div className="sr-tile"><div className="sr-tile-label">R²</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{(model.rSquared * 100).toFixed(0)}%</div></div>
              <div className="sr-tile"><div className="sr-tile-label">{t("Systematic risk")}</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{(model.systematicShare * 100).toFixed(0)}%</div></div>
              <div className="sr-tile"><div className="sr-tile-label">{t("Idiosyncratic risk")}</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: "var(--sr-warn)" }}>{(model.idiosyncraticShare * 100).toFixed(0)}%</div></div>
              <div className="sr-tile"><div className="sr-tile-label">{t("Idiosyncratic vol")}</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{(model.residualVol * Math.sqrt(12)).toFixed(1)}%</div><div style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>{t("annualized")}</div></div>
              <div className="sr-tile"><div className="sr-tile-label">{t("Observations")}</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800 }}>{model.n}</div><div style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>{t(`${(model.n / model.k).toFixed(1)} per parameter`)}</div></div>
            </div>

            <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-warn) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--sr-warn) 22%, transparent)", fontSize: "var(--sr-t-xs)", lineHeight: 1.6 }}>
              <Trans text={`<s1>${(model.idiosyncraticShare * 100).toFixed(0)}% of ${ticker}'s variance is company-specific.</s1> Under CAPM that risk is diversifiable: it disappears in a portfolio, so <s2>nobody pays you to bear it</s2>. It is also, per Pontiff (2006), the biggest cost of holding an arbitrage — which is why it feeds the friction calculation below.`} s1={(c) => <strong>{c}</strong>} s2={(c) => <em>{c}</em>} /></div>

            <div style={{ overflowX: "auto", marginTop: "var(--sr-sp-3)" }}>
              <table className="sr-table">
                <thead><tr>
                  <th>{t("Factor")}</th>
                  <th style={{ textAlign: "right" }}>{t("Beta")}</th>
                  <th style={{ textAlign: "right" }}>{t("Std. error")}</th>
                  <th style={{ textAlign: "right" }}>t</th>
                  <th style={{ textAlign: "right" }}>{t("% of variance")}</th>
                </tr></thead>
                <tbody>
                  {model.loadings.map((l) => (
                    <tr key={l.factor} style={{ opacity: l.significant ? 1 : 0.55 }}>
                      <td style={{ fontWeight: 600 }}>{t(FACTOR_LABELS[l.factor] ?? l.factor)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }} className="num">{l.beta >= 0 ? "+" : ""}{l.beta.toFixed(3)}</td>
                      <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{l.stdError.toFixed(3)}</td>
                      <td style={{ textAlign: "right", color: l.significant ? "var(--sr-text)" : "var(--sr-text-3)" }} className="num">{l.tStat.toFixed(1)}</td>
                      <td style={{ textAlign: "right" }} className="num">{(l.varianceShare * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid var(--sr-border)" }}>
                    <td style={{ fontWeight: 600, color: "var(--sr-text-3)" }}>{t("Alpha (monthly)")}</td>
                    <td style={{ textAlign: "right" }} className="num">{model.alpha >= 0 ? "+" : ""}{model.alpha.toFixed(3)}%</td>
                    <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{model.alphaStdError.toFixed(3)}</td>
                    <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{model.alphaTStat.toFixed(1)}</td>
                    <td style={{ textAlign: "right", color: "var(--sr-text-3)" }}>—</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)", lineHeight: 1.6 }}>
              <Trans text={"Dimmed rows have |t| < 2: <s1>they are not distinguishable from zero</s1> and shouldn't be read as exposure. Publishing betas without their t would be exactly the sin this product calls out."} s1={(c) => <strong>{c}</strong>} />{model.warnings.map((w, i) => <div key={i} style={{ marginTop: 4, color: "var(--sr-warn)" }}>⚠ {w}</div>)}
            </div>

            {readings.length > 0 && (
              <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
                <div style={{ fontWeight: 700, fontSize: "var(--sr-t-sm)", marginBottom: 4 }}>{t("In one sentence")}</div>
                <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.6 }}>
                  {t(`${ticker} behaves like a position ${readings.join(" · ")}.`)}</div>
              </div>
            )}

            <div className="section-label" style={{ marginTop: "var(--sr-sp-4)" }}>{t("Scenarios")}</div>
            <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-2)" }}>
              {t("Linear impact of a shock, using the betas above. A first-order approximation: it doesn't capture convexity or that betas change across regimes.")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--sr-sp-2)" }}>
              {SCENARIOS.map((s) => {
                const known = Object.keys(s.shocks).every((k) => model.loadings.some((l) => l.factor === k));
                if (!known) return null;
                const r = scenarioImpact(model, s.shocks);
                const tone = r.total >= 0 ? "var(--sr-pos)" : "var(--sr-neg)";
                return (
                  <div key={s.label} style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${tone} 8%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${tone} 22%, transparent)` }}>
                    <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{tv(s.label)}</div>
                    <div className="num" style={{ fontSize: "var(--sr-t-base)", fontWeight: 800, color: tone }}>{r.total >= 0 ? "+" : ""}{r.total.toFixed(2)}%</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!model && !loading && ran && !error && (
          <div className="sr-hint" style={{ marginTop: "var(--sr-sp-3)" }}>{t("No model: check the available history.")}</div>
        )}
      </div>

      {/* ── Fricciones de arbitraje (Shleifer & Vishny) ── */}
      <div className="card">
        <div className="section-label">{t("Arbitrage cost · Shleifer & Vishny (1997)")}</div>
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55 }}>
          {t("How much it would cost a professional to correct a mispricing in this name. High friction means a discount can persist for a long time — or never close. It is not a buy signal: it is the context that says how long convergence might take.")}{!model && <> {" "}{t("Fit the model above to include idiosyncratic volatility, the dominant component.")}</>}
        </div>

        {!frictions ? (
          <div className="sr-hint">{t("Not enough data to estimate the arbitrage cost.")}</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-3)" }}>
              <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800 }}>{frictions.score.toFixed(0)}<span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}>/100</span></div>
              <div style={{ fontWeight: 700 }}>{t(FRICCION_LABEL[frictions.band] ?? frictions.band)} {" "}{t("friction")}</div>
              <div className="sr-hint">{t(`${frictions.covered} of 5 components`)}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
              {frictions.components.map((c) => (
                <div key={c.key} style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
                  <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{tv(c.label)}</div>
                  <div className="num" style={{ fontSize: "var(--sr-t-base)", fontWeight: 800 }}>{c.key === "size" ? (c.raw >= 1e12 ? `$${(c.raw / 1e12).toFixed(2)}T` : `$${(c.raw / 1e9).toFixed(1)}B`) : c.raw.toFixed(2)}</div>
                  <div className="num" style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>{t(`friction ${c.score.toFixed(0)}`)}</div>
                </div>
              ))}
            </div>
            {frictions.readings.map((r, i) => (
              <div key={i} className="sr-hint" style={{ lineHeight: 1.6, marginBottom: 4 }}>{t(r)}</div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
