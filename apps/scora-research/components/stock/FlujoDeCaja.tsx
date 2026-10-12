"use client";
import { useMemo } from "react";
import {
  desdeFMP, diagnosticar, banderas, sankeyCaja, UMBRALES,
  type FilaFMP, type FilaBalance, type FilaResultados, type Gravedad, CONCEPTO_NO_EXPLICADO } from "@/lib/flujoCaja";
import type { StockData } from "@/app/stock/[ticker]/page";

interface Props { data: StockData | null; loading?: boolean }

const COLOR: Record<Gravedad, string> = { alerta: "var(--sr-neg)", aviso: "var(--sr-warn)" };
const ETIQUETA: Record<Gravedad, string> = { alerta: "Alert", aviso: "Notice" };

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

  if (loading && !modelo) return <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}><div className="sr-hint">Loading the cash-flow statement…</div></div>;

  // ⚠️ Sin cuatro trimestres NO se dibuja nada. Un TTM incompleto presentado como anual es una
  // cifra falsa, no una aproximación: el CFO saldría un 25 % corto y todos los ratios con él.
  if (!modelo || !d || !sk) {
    return (
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        <div className="section-label">Cash flow</div>
        <div className="sr-hint">There aren&apos;t four complete quarters of cash-flow statements, so the trailing year isn&apos;t computed. A partial sum looks like data and isn&apos;t.</div>
      </div>
    );
  }

  const origenes = sk.flujos.filter((x) => x.lado === "origen");
  const destinos = sk.flujos.filter((x) => x.lado === "destino");
  const total = Math.max(origenes.reduce((a, b) => a + b.valor, 0), 1);

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
      <div className="section-label">Cash flow · if it isn&apos;t cash, it doesn&apos;t count</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55, maxWidth: 660 }}>
        El beneficio reconoce ingresos que aún no se han cobrado y gastos que se pagaron hace años. Por eso beneficio y
        caja divergen, y por eso una empresa puede batir estimaciones y caer en bolsa.
      </div>

      {/* ── El diagnóstico ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-4)" }}>
        <div className="sr-tile">
          <div className="sr-tile-label">Cash conversion</div>
          <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: d.cashConversion == null ? "var(--sr-text-3)" : d.cashConversion < UMBRALES.cashConversionMala ? "var(--sr-neg)" : "var(--sr-pos)" }}>
            {d.cashConversion == null ? "—" : `${fmt(d.cashConversion)}×`}
          </div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>operating cash flow ÷ net income</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">Margin on sales</div>
          <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{d.margenCFO == null ? "—" : `${(d.margenCFO * 100).toFixed(1)} %`}</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>operating cash</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">Free cash flow</div>
          <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{d.financiera ? "n/a" : dinero(d.fcf)}</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>{d.financiera ? "not applicable to a financial" : "operating − capex"}</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">FCF yield</div>
          <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: d.fcfYield != null && d.fcfYield >= 0.04 ? "var(--sr-pos)" : undefined }}>
            {d.fcfYield == null ? "—" : `${(d.fcfYield * 100).toFixed(1)} %`}
          </div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>gets interesting from 4-5%</div>
        </div>
      </div>

      {/* ⚠️ UN BANCO NO SE LEE CON LA PLANTILLA DE UNA INDUSTRIAL. Su flujo operativo negativo es
          normal porque conceder préstamos ES su operación. JPMorgan salía con conversión −1,83 y
          bandera roja hasta que se suprimieron esas lecturas para financieras. */}
      {d.financiera && (
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-text-3) 8%, transparent)", lineHeight: 1.55 }}>
          This is a financial institution. Its operating cash flow can be negative without meaning anything bad — making
          loans <em>is</em> its operation. That&apos;s why free cash flow isn&apos;t computed here and working-capital flags
          aren&apos;t raised: reading it with an industrial company&apos;s template would give a false diagnosis.
        </div>
      )}

      {/* ── Las banderas ───────────────────────────────────────────────────────────── */}
      <div className="section-label">Flags</div>
      {bs.length === 0 ? (
        <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-4)" }}>None of the six signals trips at the published thresholds.</div>
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
      <div className="section-label">Where the cash goes</div>
      {!sk.cuadra ? (
        // ⚠️ MISMO LISTÓN QUE EL SANKEY DE RESULTADOS: si no cuadra con la variación declarada,
        // NO se publica. Escalar las barras para que encajen es la forma bonita de mentir.
        <div className="sr-hint" style={{ lineHeight: 1.55 }}>
          The breakdown doesn&apos;t reconcile with the change in cash the company reports
          {sk.residuo != null && <> (difference of {dinero(sk.residuo)})</>}, so it isn&apos;t drawn. A chart that doesn&apos;t
          reconcile gets fixed by scaling the bars — it looks nice and it lies.
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-4)" }}>
            {([["Where it comes from", origenes], ["Where it goes", destinos]] as const).map(([titulo, lista]) => (
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
            Reconciles: operating + investing + financing + FX effect = reported change in cash.
            {sk.nivel === "minimo" && " No fine breakdown of capex or shareholder returns, so the aggregates are shown whole."}
            {sk.flujos.some((x) => x.concepto === CONCEPTO_NO_EXPLICADO) && " The “Unexplained” block is the part the three flows don’t cover: it’s drawn at its real size instead of being spread across the others to make it fit."}
          </div>
        </>
      )}
    </div>
  );
}
