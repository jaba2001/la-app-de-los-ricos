"use client";
import { useEffect, useState } from "react";
import type { FilaCalidad } from "@/lib/calidadContableDatos";

interface Props { ticker: string }

const n2 = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));
const pct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)} %`;

/**
 * LO QUE LOS PROPIOS NÚMEROS DE LA EMPRESA REVELAN SIN QUE NADIE LO DECLARE.
 *
 * Dos medidas que ningún panel para minoristas enseña:
 *
 *   · **La vida útil implícita** de su inmovilizado. Alargarla baja el gasto por depreciación y
 *     sube el beneficio SIN que entre un euro de caja. No se puede preguntar —casi nadie la
 *     etiqueta en XBRL— así que se deriva de `inmovilizado bruto ÷ depreciación`.
 *   · **El precio al que la directiva recompró** sus propias acciones. No es la opinión de un
 *     analista: es la dirección poniendo el dinero de la empresa en una banda de precio concreta.
 *
 * ⚠️ ES UNA FOTO PRECALCULADA, y la pantalla lo dice. La web habla con FMP, y FMP **no expone**
 * lo que estas dos medidas necesitan: no da el inmovilizado BRUTO (sólo el neto), no separa la
 * depreciación de la amortización de intangibles, y no publica las ACCIONES recompradas. Todo
 * eso sale de EDGAR. Se comprobó ANTES de construir esto, no después.
 *
 * Toda la aritmética vive en `lib/vidaUtil.ts` y `lib/recompras.ts`, con 89 asserts.
 */
export default function CalidadContable({ ticker }: Props) {
  const [fila, setFila] = useState<FilaCalidad | null | undefined>(undefined);
  const [asOf, setAsOf] = useState<string>("");
  const [universo, setUniverso] = useState<number>(0);

  useEffect(() => {
    let vivo = true;
    // Carga diferida: son ~93 KB y sólo hacen falta en esta pestaña.
    import("@/lib/calidadContableDatos").then((m) => {
      if (!vivo) return;
      setFila(m.CALIDAD_CONTABLE[ticker.toUpperCase()] ?? null);
      setAsOf(m.CALIDAD_ASOF);
      setUniverso(m.CALIDAD_UNIVERSO);
    }).catch(() => { if (vivo) setFila(null); });
    return () => { vivo = false; };
  }, [ticker]);

  if (fila === undefined) return <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}><div className="sr-hint">Loading…</div></div>;

  const tieneVida = fila?.vidaCorregida != null;
  const tieneRec = fila?.precioRecompra != null;

  if (!fila || (!tieneVida && !tieneRec)) {
    return (
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        <div className="section-label">What its accounts reveal</div>
        <div className="sr-hint" style={{ lineHeight: 1.55 }}>
          Not enough data for {ticker.toUpperCase()}. The implied useful life needs <strong>gross</strong>{" "}
          fixed assets for two fiscal years and the buyback price needs the number of
          <strong> shares</strong> repurchased, and not every company tags those figures in its
          filings. Index coverage is 63% and 62%; this is a data gap, not a judgment on the
          company.
        </div>
      </div>
    );
  }

  const sesgo = fila.vidaIngenua != null && fila.vidaCorregida != null ? fila.vidaIngenua - fila.vidaCorregida : null;

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
      <div className="section-label">What its accounts reveal</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55, maxWidth: 680 }}>
        Two figures the company doesn&apos;t state but that can be derived from the ones it does
        publish: how many years it assumes its assets last, and what price it paid for its own shares.
      </div>

      {/* ── La vida útil implícita ─────────────────────────────────────────────────── */}
      {tieneVida && (
        <div style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>Implied useful life of its fixed assets</div>
          <div style={{ display: "flex", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-2)" }}>
            <div className="sr-tile">
              <div className="sr-tile-label">Corrected</div>
              <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{n2(fila.vidaCorregida)} years</div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>the one that counts</div>
            </div>
            <div className="sr-tile">
              <div className="sr-tile-label">Uncorrected</div>
              <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: "var(--sr-text-3)" }}>{n2(fila.vidaIngenua)} years</div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>
                {sesgo != null && sesgo > 0.05 ? `overstates by ${n2(sesgo)} years` : "no material bias"}
              </div>
            </div>
            {fila.vidaPrevia != null && (
              <div className="sr-tile">
                <div className="sr-tile-label">A year ago</div>
                <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{n2(fila.vidaPrevia)} years</div>
              </div>
            )}
            <div className="sr-tile">
              <div className="sr-tile-label">Asset growth</div>
              <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{pct(fila.crecimientoPct, 0)}</div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>{fila.ruidoso ? "so high the figure is noisy" : "in the normal range"}</div>
            </div>
          </div>

          {/* ⚠️ EL SESGO EXPLICADO, porque es la mitad del valor de esta medida. `bruto/depreciación`
              se infla sola cuando el activo crece: lo comprado este año aún no ha depreciado. Medido
              sobre el índice, la mediana del sesgo son 0,56 años y el máximo 17,2 (UPS). Sin
              corregir, en un auge de inversión la métrica acusaría a todo el mundo. */}
          <div className="sr-hint" style={{ lineHeight: 1.6, maxWidth: 700 }}>
            The uncorrected figure inflates on its own when assets grow, because what was bought
            this year hasn&apos;t depreciated yet. The corrected one uses the fiscal-year average base.
            {fila.viaDep === "total_contaminado" && (
              <> <strong>Note:</strong> this company doesn&apos;t separate depreciation from amortization of
              intangibles in its accounts, so the figure includes both and comes out shorter than reality.</>
            )}
          </div>

          {(fila.senales ?? []).map((s) => (
            <div key={s.clave} style={{ marginTop: "var(--sr-sp-2)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", borderLeft: "3px solid var(--sr-warn)", background: "color-mix(in srgb, var(--sr-warn) 8%, transparent)" }}>
              {/* ⚠️ SIEMPRE «AVISO», NUNCA «ALERTA». La métrica no puede separar un cambio de
                  criterio contable de un cambio en lo que la empresa compra: un centro de datos son
                  servidores de 5 años y obra civil de 30. Marcarlo como alerta sería acusar con una
                  prueba que no distingue las dos cosas. */}
              <div style={{ fontWeight: 700, color: "var(--sr-warn)", fontSize: "var(--sr-t-xs)", textTransform: "uppercase", letterSpacing: ".04em" }}>Notice</div>
              <div style={{ lineHeight: 1.55, marginTop: 2 }}>{s.texto}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── El precio de recompra ──────────────────────────────────────────────────── */}
      {tieneRec && (
        <div>
          <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>
            The price management paid to buy back its own shares
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-2)" }}>
            <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800 }}>
              {fila.precioRecompra?.toFixed(2)}
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}> per share</span>
            </div>
            {fila.retornoRecompraPct != null && (
              <div style={{ fontWeight: 700, color: fila.retornoRecompraPct >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }}>
                the stock is {pct(fila.retornoRecompraPct)} since then
              </div>
            )}
            {fila.anoRecompra != null && <div className="sr-hint">fiscal year {fila.anoRecompra}</div>}
          </div>
          <div className="sr-hint" style={{ lineHeight: 1.6, maxWidth: 700 }}>
            {fila.retornoRecompraPct == null
              ? "No current price to compare it with."
              : fila.retornoRecompraPct >= 0
                ? "With its own money, management put fair value below where the stock trades today, and so far it has worked out. That is what they believed then, not a forecast of what the stock will do."
                : "It paid above where the market is today: a capital-allocation decision that has destroyed value. That —not the future price— is something management can fairly be judged on."}
          </div>
          {fila.recompraCreible !== true && (
            <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>
              ⚠️ It couldn&apos;t be checked against the range the stock traded in that fiscal year, so
              the average price is unverified.
            </div>
          )}
        </div>
      )}

      {/* ⚠️ LA FECHA, SIEMPRE. Es una foto precalculada, no un dato vivo, y esconderlo sería
          presentar como actual algo que puede tener semanas. */}
      <div className="sr-hint" style={{ marginTop: "var(--sr-sp-4)", lineHeight: 1.6 }}>
        Snapshot computed on {asOf} across {universo} index companies, from SEC filings. It doesn&apos;t
        update on its own: FMP —the live source for the rest of this page— publishes neither gross
        fixed assets nor shares repurchased, which is what these two measures need.
      </div>
    </div>
  );
}
