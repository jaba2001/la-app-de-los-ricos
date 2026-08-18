"use client";
import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/proxy";
import { realizedVolFromCloses, varianceRiskPremium, type VarianceRiskPremium as Vrp } from "@/lib/greeks";
import { fromHistory } from "@/lib/factorData";
import type { MacroState } from "@/lib/types";

interface Props { macro: MacroState | null }

interface Row { label: string; sessions: number; realized: number; vrp: Vrp }

const TONE: Record<string, string> = {
  cara: "var(--sr-warn)", neutral: "var(--sr-text-2)", barata: "var(--sr-pos)",
};

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
    if (!(vix != null && vix > 0)) { setError("VIX no disponible en el snapshot macro."); return; }
    setLoading(true); setError("");
    try {
      const raw = await authedFetch<Record<string, unknown>[]>(`/api/fmp/historical-price-eod/full?symbol=SPY`);
      const closes = fromHistory(Array.isArray(raw) ? raw : []).map((r) => r.close); // cronológico
      if (closes.length < 40) { setError("Historial de SPY insuficiente."); setLoading(false); return; }

      // Tres ventanas: el VIX mira 30 días vista, así que la comparación honesta es contra la
      // realizada de ~1 mes. Las de 3 meses y 1 año se muestran como contexto de régimen.
      const windows: [string, number][] = [["1 mes", 21], ["3 meses", 63], ["1 año", 252]];
      const out: Row[] = [];
      for (const [label, sessions] of windows) {
        const rv = realizedVolFromCloses(closes.slice(-sessions - 1), 252);
        if (rv == null) continue;
        const vrp = varianceRiskPremium(vix / 100, rv);
        if (!vrp) continue;
        out.push({ label, sessions, realized: rv, vrp });
      }
      if (!out.length) { setError("No se pudo calcular la volatilidad realizada."); setLoading(false); return; }
      setRows(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fallo al calcular la prima de varianza");
    }
    setLoading(false);
  }, [vix]);

  // Se calcula solo al llegar el VIX: es una lectura de contexto, no algo que el usuario
  // deba pedir con un botón.
  useEffect(() => { if (vix != null && vix > 0 && !rows && !loading) void run(); }, [vix, rows, loading, run]);

  const headline = rows?.[0];

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
      <div className="section-label">Variance risk premium · lo que el mercado cobra por el seguro</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55, maxWidth: 640 }}>
        El VIX es la volatilidad <strong>implícita</strong>: lo que hay que pagar hoy por cubrirse. La realizada de SPY
        es la que la volatilidad <strong>resultó</strong> ser. La diferencia (IV² − RV²) es la prima de riesgo de
        varianza, persistentemente positiva — es la razón por la que vender volatilidad gana dinero la mayoría de los
        meses y lo devuelve todo de golpe en unos pocos.
      </div>

      {error && <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-warn) 10%, transparent)", color: "var(--sr-warn)", fontSize: "var(--sr-t-xs)" }}>{error}</div>}
      {loading && !rows && <div className="sr-hint">Calculando…</div>}

      {rows && headline && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-3)" }}>
            <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: TONE[headline.vrp.richness] }}>
              {headline.vrp.volPoints >= 0 ? "+" : ""}{headline.vrp.volPoints.toFixed(1)}
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}> pts de vol</span>
            </div>
            <div style={{ fontWeight: 700, textTransform: "capitalize", color: TONE[headline.vrp.richness] }}>
              volatilidad {headline.vrp.richness}
            </div>
            <div className="sr-hint">VIX {vix?.toFixed(1)} vs realizada {(headline.realized * 100).toFixed(1)}% a 1 mes</div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="sr-table">
              <thead><tr>
                <th>Ventana realizada</th>
                <th style={{ textAlign: "right" }}>Realizada</th>
                <th style={{ textAlign: "right" }}>VIX − RV (pts vol)</th>
                <th style={{ textAlign: "right" }}>IV² − RV² (pts var)</th>
                <th style={{ textAlign: "right" }}>IV / RV</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td style={{ fontWeight: 600 }}>{r.label}<span className="sr-hint"> · {r.sessions} sesiones</span></td>
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
            Comparación imperfecta a propósito y conviene saberlo: el VIX es un pronóstico a 30 días naturales sobre
            opciones del S&amp;P 500, mientras la realizada mira hacia atrás. La fila de 1 mes es la única que compara
            horizontes parecidos; las otras dos son contexto de régimen, no la prima. Bandas de ±2 puntos tratadas como
            ruido de estimación, no como señal.
          </div>
        </>
      )}
    </div>
  );
}
