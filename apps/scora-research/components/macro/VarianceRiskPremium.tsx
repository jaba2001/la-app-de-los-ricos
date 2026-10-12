"use client";
import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/proxy";
import { realizedVolFromCloses, varianceRiskPremium, type VarianceRiskPremium as Vrp } from "@/lib/greeks";
import { fromHistory } from "@/lib/factorData";
import type { MacroState } from "@/lib/types";
import { t, tv } from "@/lib/i18n/cliente";
import Trans from "@/components/Trans";

interface Props { macro: MacroState | null }

interface Row { label: string; sessions: number; realized: number; vrp: Vrp }

const TONE: Record<string, string> = {
  cara: "var(--sr-warn)", neutral: "var(--sr-text-2)", barata: "var(--sr-pos)",
};
/** Nombre en pantalla (la clave de lib/greeks.ts sigue en español). */
const RICHNESS_LABEL: Record<string, string> = { cara: "Expensive volatility", neutral: "Neutral volatility", barata: "Cheap volatility" };

/**
 * Prima de riesgo de varianza del ÍNDICE — la pieza de medición de Black-Scholes que sale
 * gratis: `macro_state.vix` es la volatilidad que el mercado COBRA; la realizada de SPY es
 * la que la volatilidad resultó ser. La diferencia es persistentemente positiva
 * (Bollerslev-Tauchen-Zhou 2009) y es de las primas mejor documentadas que existen.
 *
 * Nada de esto necesita una cadena de opciones ni un feed de pago.
 */
export default function VarianceRiskPremium({ macro }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const vix = macro?.vix != null ? Number(macro.vix) : null;

  const run = useCallback(async () => {
    if (!(vix != null && vix > 0)) { setError(t("VIX isn't available in the macro snapshot.")); return; }
    setLoading(true); setError("");
    try {
      const raw = await authedFetch<Record<string, unknown>[]>(`/api/fmp/historical-price-eod/full?symbol=SPY`);
      const closes = fromHistory(Array.isArray(raw) ? raw : []).map((r) => r.close); // cronológico
      if (closes.length < 40) { setError(t("Not enough SPY history.")); setLoading(false); return; }

      // Tres ventanas: el VIX mira 30 días vista, así que la comparación honesta es contra la
      // realizada de ~1 mes. Las de 3 meses y 1 año se muestran como contexto de régimen.
      const windows: [string, number][] = [["1 month", 21], ["3 months", 63], ["1 year", 252]];
      const out: Row[] = [];
      for (const [label, sessions] of windows) {
        const rv = realizedVolFromCloses(closes.slice(-sessions - 1), 252);
        if (rv == null) continue;
        const vrp = varianceRiskPremium(vix / 100, rv);
        if (!vrp) continue;
        out.push({ label, sessions, realized: rv, vrp });
      }
      if (!out.length) { setError(t("Couldn't compute realized volatility.")); setLoading(false); return; }
      setRows(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't compute the variance premium"));
    }
    setLoading(false);
  }, [vix]);

  // Se calcula solo al llegar el VIX: es una lectura de contexto, no algo que el usuario
  // deba pedir con un botón.
  //
  // `!error`: sin él, un fallo (FMP sin cuota y Yahoo caído, nuestro propio 429) dejaba `rows`
  // vacío y `loading` volvía a false, así que el efecto se relanzaba en el acto, para siempre:
  // ~700 peticiones por segundo mientras la pestaña siguiera abierta. Se reintenta al volver a
  // la pestaña, que desmonta y monta el componente.
  useEffect(() => { if (vix != null && vix > 0 && !rows && !loading && !error) void run(); }, [vix, rows, loading, error, run]);

  const headline = rows?.[0];

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
      <div className="section-label">{t("Variance risk premium · what the market charges for insurance")}</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55, maxWidth: 640 }}>
        <Trans text={"VIX is <s1>implied</s1> volatility: what it costs today to hedge. SPY's realized volatility is what volatility <s2>turned out</s2> to be. The difference (IV² − RV²) is the variance risk premium, persistently positive — it is why selling volatility makes money most months and gives it all back at once in a few."} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} /></div>

      {error && <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-warn) 10%, transparent)", color: "var(--sr-warn)", fontSize: "var(--sr-t-xs)" }}>{error}</div>}
      {loading && !rows && <div className="sr-hint">{t("Calculating…")}</div>}

      {rows && headline && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-3)" }}>
            <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: TONE[headline.vrp.richness] }}>
              {headline.vrp.volPoints >= 0 ? "+" : ""}{headline.vrp.volPoints.toFixed(1)}
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}> {" "}{t("vol pts")}</span>
            </div>
            <div style={{ fontWeight: 700, color: TONE[headline.vrp.richness] }}>
              {t(RICHNESS_LABEL[headline.vrp.richness] ?? headline.vrp.richness)}
            </div>
            <div className="sr-hint">{t(`VIX ${vix?.toFixed(1)} vs 1-month realized ${(headline.realized * 100).toFixed(1)}%`)}</div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="sr-table">
              <thead><tr>
                <th>{t("Realized window")}</th>
                <th style={{ textAlign: "right" }}>{t("Realized")}</th>
                <th style={{ textAlign: "right" }}>{t("VIX − RV (pts vol)")}</th>
                <th style={{ textAlign: "right" }}>{t("IV² − RV² (pts var)")}</th>
                <th style={{ textAlign: "right" }}>IV / RV</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td style={{ fontWeight: 600 }}>{tv(r.label)}<span className="sr-hint"> {" "}{t(`· ${r.sessions} sessions`)}</span></td>
                    <td style={{ textAlign: "right" }} className="num">{(r.realized * 100).toFixed(1)}%</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: TONE[r.vrp.richness] }} className="num">{r.vrp.volPoints >= 0 ? "+" : ""}{r.vrp.volPoints.toFixed(1)}</td>
                    <td style={{ textAlign: "right" }} className="num">{r.vrp.variancePoints >= 0 ? "+" : ""}{r.vrp.variancePoints.toFixed(0)}</td>
                    <td style={{ textAlign: "right" }} className="num">{r.vrp.ratio.toFixed(2)}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sr-hint" style={{ marginTop: "var(--sr-sp-3)", lineHeight: 1.6 }}>
            {t("An imperfect comparison on purpose, and worth knowing: VIX is a 30-calendar-day forecast from S&P 500 options, while realized volatility looks backward. The 1-month row is the only one comparing similar horizons; the other two are regime context, not the premium. Bands of ±2 points are treated as estimation noise, not signal.")}</div>
        </>
      )}
    </div>
  );
}
