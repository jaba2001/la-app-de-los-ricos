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

  if (fila === undefined) return <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}><div className="sr-hint">Cargando…</div></div>;

  const tieneVida = fila?.vidaCorregida != null;
  const tieneRec = fila?.precioRecompra != null;

  if (!fila || (!tieneVida && !tieneRec)) {
    return (
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        <div className="section-label">Lo que revela su contabilidad</div>
        <div className="sr-hint" style={{ lineHeight: 1.55 }}>
          Para {ticker.toUpperCase()} no hay datos suficientes. La vida útil implícita necesita el
          inmovilizado <strong>bruto</strong> de dos ejercicios y el precio de recompra necesita las
          <strong> acciones</strong> recompradas, y no todas las empresas etiquetan esas cifras en sus
          cuentas. Sobre el índice hay cobertura del 63 % y el 62 %; es un hueco de los datos, no un
          juicio sobre la empresa.
        </div>
      </div>
    );
  }

  const sesgo = fila.vidaIngenua != null && fila.vidaCorregida != null ? fila.vidaIngenua - fila.vidaCorregida : null;

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
      <div className="section-label">Lo que revela su contabilidad</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55, maxWidth: 680 }}>
        Dos cifras que la empresa no declara y que se pueden deducir de las que sí publica: cuántos
        años supone que le duran sus activos, y a qué precio compró sus propias acciones.
      </div>

      {/* ── La vida útil implícita ─────────────────────────────────────────────────── */}
      {tieneVida && (
        <div style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>Vida útil implícita de su inmovilizado</div>
          <div style={{ display: "flex", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-2)" }}>
            <div className="sr-tile">
              <div className="sr-tile-label">Corregida</div>
              <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{n2(fila.vidaCorregida)} años</div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>la que vale</div>
            </div>
            <div className="sr-tile">
              <div className="sr-tile-label">Sin corregir</div>
              <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: "var(--sr-text-3)" }}>{n2(fila.vidaIngenua)} años</div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>
                {sesgo != null && sesgo > 0.05 ? `exagera ${n2(sesgo)} años` : "sin sesgo apreciable"}
              </div>
            </div>
            {fila.vidaPrevia != null && (
              <div className="sr-tile">
                <div className="sr-tile-label">Hace un año</div>
                <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{n2(fila.vidaPrevia)} años</div>
              </div>
            )}
            <div className="sr-tile">
              <div className="sr-tile-label">Crecimiento del activo</div>
              <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{pct(fila.crecimientoPct, 0)}</div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>{fila.ruidoso ? "tan alto que la cifra es ruidosa" : "en rango normal"}</div>
            </div>
          </div>

          {/* ⚠️ EL SESGO EXPLICADO, porque es la mitad del valor de esta medida. `bruto/depreciación`
              se infla sola cuando el activo crece: lo comprado este año aún no ha depreciado. Medido
              sobre el índice, la mediana del sesgo son 0,56 años y el máximo 17,2 (UPS). Sin
              corregir, en un auge de inversión la métrica acusaría a todo el mundo. */}
          <div className="sr-hint" style={{ lineHeight: 1.6, maxWidth: 700 }}>
            La cifra sin corregir se infla sola cuando el activo crece, porque lo comprado este año
            aún no ha depreciado. La corregida usa la base media del ejercicio.
            {fila.viaDep === "total_contaminado" && (
              <> <strong>Ojo:</strong> esta empresa no separa la depreciación de la amortización de
              intangibles en sus cuentas, así que la cifra incluye las dos y sale más corta de lo real.</>
            )}
          </div>

          {(fila.senales ?? []).map((s) => (
            <div key={s.clave} style={{ marginTop: "var(--sr-sp-2)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", borderLeft: "3px solid var(--sr-warn)", background: "color-mix(in srgb, var(--sr-warn) 8%, transparent)" }}>
              {/* ⚠️ SIEMPRE «AVISO», NUNCA «ALERTA». La métrica no puede separar un cambio de
                  criterio contable de un cambio en lo que la empresa compra: un centro de datos son
                  servidores de 5 años y obra civil de 30. Marcarlo como alerta sería acusar con una
                  prueba que no distingue las dos cosas. */}
              <div style={{ fontWeight: 700, color: "var(--sr-warn)", fontSize: "var(--sr-t-xs)", textTransform: "uppercase", letterSpacing: ".04em" }}>Aviso</div>
              <div style={{ lineHeight: 1.55, marginTop: 2 }}>{s.texto}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── El precio de recompra ──────────────────────────────────────────────────── */}
      {tieneRec && (
        <div>
          <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>
            A qué precio recompró la directiva sus propias acciones
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-2)" }}>
            <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800 }}>
              {fila.precioRecompra?.toFixed(2)}
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}> por acción</span>
            </div>
            {fila.retornoRecompraPct != null && (
              <div style={{ fontWeight: 700, color: fila.retornoRecompraPct >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }}>
                la acción está {pct(fila.retornoRecompraPct)} desde entonces
              </div>
            )}
            {fila.anoRecompra != null && <div className="sr-hint">ejercicio {fila.anoRecompra}</div>}
          </div>
          <div className="sr-hint" style={{ lineHeight: 1.6, maxWidth: 700 }}>
            {fila.retornoRecompraPct == null
              ? "No hay precio actual con el que compararlo."
              : fila.retornoRecompraPct >= 0
                ? "Con su propio dinero, la dirección situó el valor razonable por debajo de donde cotiza hoy, y de momento le ha salido bien. Es lo que creían entonces, no un pronóstico sobre lo que hará la acción."
                : "Pagó por encima de donde está el mercado hoy: es una decisión de asignación de capital que ha destruido valor. Sobre eso —no sobre el precio futuro— sí se puede juzgar a una dirección."}
          </div>
          {fila.recompraCreible !== true && (
            <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>
              ⚠️ No se ha podido comprobar contra el rango en que la acción cotizó ese ejercicio, así
              que el precio medio va sin verificar.
            </div>
          )}
        </div>
      )}

      {/* ⚠️ LA FECHA, SIEMPRE. Es una foto precalculada, no un dato vivo, y esconderlo sería
          presentar como actual algo que puede tener semanas. */}
      <div className="sr-hint" style={{ marginTop: "var(--sr-sp-4)", lineHeight: 1.6 }}>
        Foto calculada el {asOf} sobre {universo} empresas del índice, a partir de las cuentas
        presentadas a la SEC. No se actualiza sola: FMP —la fuente en vivo del resto de la página— no
        publica ni el inmovilizado bruto ni las acciones recompradas, que es lo que estas dos medidas
        necesitan.
      </div>
    </div>
  );
}
