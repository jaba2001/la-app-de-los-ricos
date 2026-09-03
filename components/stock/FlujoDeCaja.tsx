"use client";
import { useMemo } from "react";
import {
  desdeFMP, diagnosticar, banderas, sankeyCaja, UMBRALES,
  type FilaFMP, type FilaBalance, type FilaResultados, type Gravedad,
} from "@/lib/flujoCaja";
import type { StockData } from "@/app/stock/[ticker]/page";

interface Props { data: StockData | null; loading?: boolean }

const COLOR: Record<Gravedad, string> = { alerta: "var(--sr-neg)", aviso: "var(--sr-warn)" };
const ETIQUETA: Record<Gravedad, string> = { alerta: "Alerta", aviso: "Aviso" };

const CLASE_COLOR: Record<string, string> = {
  operacion: "var(--sr-pos)",
  inversion: "var(--sr-text-2)",
  financiacion: "var(--sr-warn)",
  divisa: "var(--sr-text-3)",
  caja: "var(--sr-accent, var(--sr-text))",
  resto: "var(--sr-text-3)",
};

const fmt = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));
const dinero = (v: number | null | undefined) => {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)} B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)} M`;
  return v.toLocaleString("es");
};

/**
 * LO QUE NO ES CAJA, NO VALE.
 *
 * El beneficio reconoce ingresos que aún no se han cobrado y gastos que se pagaron hace años.
 * Por eso una empresa puede batir estimaciones y caer en bolsa. Este panel contesta a tres
 * preguntas que el beneficio no contesta: **¿se convierte en caja?**, **¿hay alguna bandera
 * roja?** y **¿a dónde va esa caja?**
 *
 * ⚠️ TODO LO QUE SE PINTA AQUÍ SALE DE `lib/flujoCaja.ts`, que es puro y está cubierto por
 * 109 asserts — incluida la traducción desde los nombres y signos de FMP, que es donde
 * estaban los bugs de verdad. Este fichero no calcula nada: sólo decide qué enseñar.
 */
export default function FlujoDeCaja({ data, loading }: Props) {
  const modelo = useMemo(() => {
    if (!data?.cashFlow?.length) return null;
    const sector = typeof data.profile?.sector === "string" ? data.profile.sector : null;
    const marketCap = Number(data.profile?.marketCap ?? data.profile?.mktCap);
    return desdeFMP(
      data.cashFlow as FilaFMP[],
      data.income as FilaResultados[],
      data.balanceSheet as FilaBalance[],
      { marketCap: Number.isFinite(marketCap) ? marketCap : null, sector },
    );
  }, [data]);

  const d = useMemo(() => (modelo ? diagnosticar(modelo) : null), [modelo]);
  const bs = useMemo(() => (modelo && d ? banderas(modelo, d) : []), [modelo, d]);
  const sk = useMemo(() => (modelo ? sankeyCaja(modelo) : null), [modelo]);

  if (loading && !modelo) return <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}><div className="sr-hint">Cargando el estado de flujos…</div></div>;

  // ⚠️ Sin cuatro trimestres NO se dibuja nada. Un TTM incompleto presentado como anual es una
  // cifra falsa, no una aproximación: el CFO saldría un 25 % corto y todos los ratios con él.
  if (!modelo || !d || !sk) {
    return (
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        <div className="section-label">Flujo de caja</div>
        <div className="sr-hint">No hay cuatro trimestres completos de estado de flujos, así que no se calcula el año móvil. Media suma parece un dato y no lo es.</div>
      </div>
    );
  }

  const origenes = sk.flujos.filter((x) => x.lado === "origen");
  const destinos = sk.flujos.filter((x) => x.lado === "destino");
  const total = Math.max(origenes.reduce((a, b) => a + b.valor, 0), 1);

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
      <div className="section-label">Flujo de caja · lo que no es caja, no vale</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55, maxWidth: 660 }}>
        El beneficio reconoce ingresos que aún no se han cobrado y gastos que se pagaron hace años. Por eso beneficio y
        caja divergen, y por eso una empresa puede batir estimaciones y caer en bolsa.
      </div>

      {/* ── El diagnóstico ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-4)" }}>
        <div className="sr-tile">
          <div className="sr-tile-label">Conversión a caja</div>
          <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: d.cashConversion == null ? "var(--sr-text-3)" : d.cashConversion < UMBRALES.cashConversionMala ? "var(--sr-neg)" : "var(--sr-pos)" }}>
            {d.cashConversion == null ? "—" : `${fmt(d.cashConversion)}×`}
          </div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>flujo operativo ÷ beneficio</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">Margen sobre ventas</div>
          <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{d.margenCFO == null ? "—" : `${(d.margenCFO * 100).toFixed(1)} %`}</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>caja de la operación</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">Flujo de caja libre</div>
          <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{d.financiera ? "n/a" : dinero(d.fcf)}</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>{d.financiera ? "no aplica a una financiera" : "operación − capex"}</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">Rentabilidad del FCF</div>
          <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: d.fcfYield != null && d.fcfYield >= 0.04 ? "var(--sr-pos)" : undefined }}>
            {d.fcfYield == null ? "—" : `${(d.fcfYield * 100).toFixed(1)} %`}
          </div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>a partir del 4-5 % empieza a interesar</div>
        </div>
      </div>

      {/* ⚠️ UN BANCO NO SE LEE CON LA PLANTILLA DE UNA INDUSTRIAL. Su flujo operativo negativo es
          normal porque conceder préstamos ES su operación. JPMorgan salía con conversión −1,83 y
          bandera roja hasta que se suprimieron esas lecturas para financieras. */}
      {d.financiera && (
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-text-3) 8%, transparent)", lineHeight: 1.55 }}>
          Es una entidad financiera. Su flujo operativo puede ser negativo sin que eso signifique nada malo — conceder
          préstamos <em>es</em> su operación. Por eso aquí no se calcula el flujo de caja libre ni se marcan las
          banderas de circulante: leerla con la plantilla de una industrial daría un diagnóstico falso.
        </div>
      )}

      {/* ── Las banderas ───────────────────────────────────────────────────────────── */}
      <div className="section-label">Banderas</div>
      {bs.length === 0 ? (
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-4)" }}>Ninguna de las seis señales salta con los umbrales publicados.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-4)" }}>
          {bs.map((b) => (
            <div key={b.clave} style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", borderLeft: `3px solid ${COLOR[b.gravedad]}`, background: `color-mix(in srgb, ${COLOR[b.gravedad]} 8%, transparent)` }}>
              <div style={{ fontWeight: 700, color: COLOR[b.gravedad], fontSize: "var(--sr-t-xs)", textTransform: "uppercase", letterSpacing: ".04em" }}>{ETIQUETA[b.gravedad]}</div>
              <div style={{ lineHeight: 1.55, marginTop: 2 }}>{b.texto}</div>
              <div className="sr-hint num" style={{ marginTop: 4 }}>
                {Object.entries(b.evidencia).map(([k, v]) => `${k}: ${typeof v === "number" ? v.toFixed(2) : String(v)}`).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── El destino de la caja ──────────────────────────────────────────────────── */}
      <div className="section-label">A dónde va la caja</div>
      {!sk.cuadra ? (
        // ⚠️ MISMO LISTÓN QUE EL SANKEY DE RESULTADOS: si no cuadra con la variación declarada,
        // NO se publica. Escalar las barras para que encajen es la forma bonita de mentir.
        <div className="sr-hint" style={{ lineHeight: 1.55 }}>
          El desglose no cuadra con la variación de caja que declara la empresa
          {sk.residuo != null && <> (diferencia de {dinero(sk.residuo)})</>}, así que no se dibuja. Un diagrama que no
          cuadra se arregla escalando las barras, queda bonito y miente.
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-4)" }}>
            {([["De dónde sale", origenes], ["A dónde va", destinos]] as const).map(([titulo, lista]) => (
              <div key={titulo}>
                <div className="sr-tile-label" style={{ marginBottom: "var(--sr-sp-2)" }}>{titulo}</div>
                {lista.map((x) => (
                  <div key={x.concepto} style={{ marginBottom: "var(--sr-sp-2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--sr-sp-2)", fontSize: "var(--sr-t-xs)" }}>
                      <span style={{ fontWeight: 600 }}>{x.concepto}</span>
                      <span className="num">{dinero(x.valor)}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "color-mix(in srgb, var(--sr-text-3) 15%, transparent)", marginTop: 3 }}>
                      <div style={{ height: "100%", borderRadius: 3, width: `${Math.min(100, (100 * x.valor) / total)}%`, background: CLASE_COLOR[x.clase] ?? "var(--sr-text-2)" }} />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="sr-hint" style={{ marginTop: "var(--sr-sp-3)", lineHeight: 1.6 }}>
            Cuadra: flujo operativo + inversión + financiación + efecto divisa = variación de la caja declarada.
            {sk.nivel === "minimo" && " Sin desglose fino de capex ni retribución, así que los agregados van enteros."}
            {sk.flujos.some((x) => x.concepto === "No explicado") && " El bloque «No explicado» es la parte que la suma de los tres flujos no cubre: se dibuja con su tamaño real en vez de repartirla entre los demás para que encaje."}
          </div>
        </>
      )}
    </div>
  );
}
