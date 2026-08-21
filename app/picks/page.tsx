// /picks — Scora Picks, en abierto desde el primer día.
//
// Server component y público, como /daily: el track record es lo que hace creíble al
// producto, y un render de cliente le daría a un buscador —y a quien comparta el enlace—
// una página vacía.
//
// Lo que esta página NO hace, a propósito: enseñar sólo las ganadoras. §7 del documento de
// reglas obliga a publicar las cerradas con su resultado, las fechas en que no se compró
// nada, y los candidatos que quedaron fuera. Es lo único que distingue un track record de
// un folleto.

import type { Metadata } from "next";
import Link from "next/link";
import {
  fetchOpenPositions, fetchClosedPositions, fetchRuns,
  positionReturn, CLOSE_REASON_LABEL, type PickPosition,
} from "@/lib/picksData";
import {
  PICKS_RULES_VERSION, TARGET_POSITIONS, BUYS_PER_DATE,
  ENTRY_PCTL, EXIT_PCTL, PERSISTENCE_DAYS, QUARANTINE_MONTHS,
} from "@/lib/picks";

export const revalidate = 900;

export const metadata: Metadata = {
  title: "Scora Picks",
  description:
    "Una cartera de reglas mecánicas, idéntica para todo el mundo, con cada decisión publicada — incluidas las fechas sin compras y todas las posiciones que salieron mal.",
  alternates: { canonical: "/picks" },
};

const pct = (v: number | null, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const tone = (v: number | null) => (v == null ? "var(--sr-text-3)" : v >= 0 ? "var(--sr-pos)" : "var(--sr-neg)");
const money = (v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="sr-tile">
      <div className="sr-tile-label">{label}</div>
      <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: color ?? "var(--sr-text)" }}>{value}</div>
      {sub && <div className="sr-hint">{sub}</div>}
    </div>
  );
}

export default async function PicksPage() {
  const [open, closed, runs] = await Promise.all([
    fetchOpenPositions(), fetchClosedPositions(), fetchRuns(60),
  ]);

  const cerradasConRetorno = closed
    .map((p) => ({ p, r: positionReturn(p) }))
    .filter((x): x is { p: PickPosition; r: number } => x.r != null);
  const aciertos = cerradasConRetorno.filter((x) => x.r > 0).length;
  const mediaCerradas = cerradasConRetorno.length
    ? cerradasConRetorno.reduce((s, x) => s + x.r, 0) / cerradasConRetorno.length
    : null;
  const sinCompra = runs.filter((r) => r.bought_count === 0).length;
  const arrancado = runs.length > 0;

  return (
    <main className="container" style={{ paddingBottom: "var(--sr-sp-6)" }}>
      <div style={{ marginBottom: "var(--sr-sp-4)" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, letterSpacing: "-0.02em" }}>Scora Picks</h1>
        <div className="sr-hint">
          Reglas fijas, sin emociones y sin retrospectiva · versión {PICKS_RULES_VERSION} · medido en vivo desde el primer día
        </div>
      </div>

      {/* Lo primero que se lee, y va antes que cualquier número. */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)", borderLeft: "3px solid var(--sr-warn, #b45309)" }}>
        <p style={{ margin: 0, fontSize: "var(--sr-t-sm)", lineHeight: 1.7 }}>
          <strong>Esto no es una recomendación de inversión ni una predicción de rentabilidad.</strong> Es lo que
          hace un sistema de reglas escritas de antemano, publicado entero: las que funcionan y las que no.
          Las reglas se diseñaron mirando datos históricos, así que su backtest{" "}
          <strong>no es evidencia fuera de muestra</strong> — es la razón para probarlas en vivo, no la prueba de
          que funcionen. Este track record empieza de cero y sólo tendrá algo que decir a partir de 24 meses.
        </p>
      </div>

      {!arrancado ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            <strong>Todavía no hay decisiones publicadas.</strong>
          </p>
          <p className="sr-hint" style={{ marginTop: "var(--sr-sp-2)", lineHeight: 1.7 }}>
            El sistema decide el día 1 y el día 15 de cada mes. Las primeras seis semanas la cartera se queda{" "}
            <strong>vacía a propósito</strong>: la regla de persistencia exige que un valor lleve{" "}
            {PERSISTENCE_DAYS} días sobre el umbral antes de poder entrar, y esa historia hay que acumularla.
            Comprando {BUYS_PER_DATE * 2} al mes, llenar las {TARGET_POSITIONS} posiciones lleva unos diez meses.
          </p>
        </div>
      ) : (
        <>
          <div className="sr-grid-4" style={{ marginBottom: "var(--sr-sp-4)" }}>
            <Tile label="Posiciones abiertas" value={`${open.length}/${TARGET_POSITIONS}`} sub={open.length < TARGET_POSITIONS ? "la cartera aún se está montando" : "cartera completa"} />
            <Tile label="Posiciones cerradas" value={String(closed.length)} sub={cerradasConRetorno.length ? `${aciertos} en positivo` : "sin cierres todavía"} />
            <Tile label="Retorno medio al cerrar" value={pct(mediaCerradas)} color={tone(mediaCerradas)} sub="simple, sin ponderar" />
            <Tile label="Fechas sin comprar" value={`${sinCompra}/${runs.length}`} sub="un hueco vacío es un resultado" />
          </div>

          <section style={{ marginBottom: "var(--sr-sp-5)" }}>
            <h2 style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, marginBottom: "var(--sr-sp-2)" }}>La cartera, entera</h2>
            {open.length === 0 ? (
              <p className="sr-hint">Ninguna posición abierta ahora mismo.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="sr-table">
                  <thead>
                    <tr><th>Valor</th><th>Desde</th><th>Percentil al comprar</th><th>Precio de compra</th></tr>
                  </thead>
                  <tbody>
                    {open.map((p) => (
                      <tr key={`${p.ticker}-${p.opened_on}`}>
                        <td><Link href={`/stock/${p.ticker}`}>{p.ticker}</Link></td>
                        <td className="num">{p.opened_on}</td>
                        <td className="num">{(p.open_pctl * 100).toFixed(0)}</td>
                        <td className="num">{money(p.open_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={{ marginBottom: "var(--sr-sp-5)" }}>
            <h2 style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, marginBottom: "var(--sr-sp-2)" }}>Todas las cerradas</h2>
            <p className="sr-hint" style={{ marginBottom: "var(--sr-sp-2)" }}>
              Las {closed.length} que se han vendido, con su resultado y su motivo. Sin excepciones: publicar sólo
              las ganadoras es lo que hace que los track records del sector no valgan nada.
            </p>
            {closed.length === 0 ? (
              <p className="sr-hint">Todavía no se ha cerrado ninguna posición.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="sr-table">
                  <thead>
                    <tr><th>Valor</th><th>Comprada</th><th>Vendida</th><th>Retorno</th><th>Por qué se vendió</th></tr>
                  </thead>
                  <tbody>
                    {closed.map((p) => {
                      const r = positionReturn(p);
                      return (
                        <tr key={`${p.ticker}-${p.opened_on}`}>
                          <td><Link href={`/stock/${p.ticker}`}>{p.ticker}</Link></td>
                          <td className="num">{p.opened_on}</td>
                          <td className="num">{p.closed_on}</td>
                          <td className="num" style={{ color: tone(r), fontWeight: 600 }}>{pct(r)}</td>
                          <td className="sr-hint">{CLOSE_REASON_LABEL[p.close_reason ?? ""] ?? p.close_reason ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={{ marginBottom: "var(--sr-sp-5)" }}>
            <h2 style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, marginBottom: "var(--sr-sp-2)" }}>Cada decisión, incluidas las de no comprar</h2>
            <p className="sr-hint" style={{ marginBottom: "var(--sr-sp-2)" }}>
              El sistema mira el día 1 y el día 15. Si nadie cumple las reglas, no compra — y esa fecha aparece
              aquí igual. Sin estas filas, un día sin compras sería indistinguible de un sistema parado.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="sr-table">
                <thead>
                  <tr><th>Fecha</th><th>Universo</th><th>Elegibles</th><th>Compras</th><th>Ventas</th><th>Cartera</th></tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.decision_date}>
                      <td className="num">{r.decision_date}</td>
                      <td className="num">{r.universe_size}</td>
                      <td className="num">{r.eligible_count}</td>
                      <td className="num" style={{ fontWeight: r.bought_count ? 600 : 400, color: r.bought_count ? "var(--sr-text)" : "var(--sr-text-3)" }}>
                        {r.bought_count || "—"}
                      </td>
                      <td className="num" style={{ color: r.sold_count ? "var(--sr-text)" : "var(--sr-text-3)" }}>{r.sold_count || "—"}</td>
                      <td className="num">{r.positions_after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="card">
        <h2 style={{ fontSize: "var(--sr-t-md)", fontWeight: 700, marginBottom: "var(--sr-sp-2)" }}>Las reglas, en cinco líneas</h2>
        <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "var(--sr-t-sm)", lineHeight: 1.8 }}>
          <li><strong>Qué se compra:</strong> los valores del S&amp;P 500 en el {(ENTRY_PCTL * 100).toFixed(0)}% mejor por calidad — rentabilidad bruta sobre activos, ROIC, margen operativo, cobertura de intereses y deuda neta. Todo de los estados financieros; nada del precio.</li>
          <li><strong>Cuándo:</strong> el primer día hábil y el día 15, {BUYS_PER_DATE} valores cada vez. Fechas fijas: no se adelantan porque el mercado caiga ni se retrasan porque «esté caro».</li>
          <li><strong>Persistencia:</strong> hay que cumplir el umbral {PERSISTENCE_DAYS} días seguidos. Sin esto se compra el pico de un día.</li>
          <li><strong>Cuándo se vende:</strong> si la señal cae bajo el percentil {(EXIT_PCTL * 100).toFixed(0)} en dos evaluaciones seguidas, si un pilar entra en el decil inferior de su sector, o si deja de cumplir el universo. <strong>No hay stop-loss por precio</strong>: un stop es una regla sobre el precio, no sobre el negocio.</li>
          <li><strong>Pesos:</strong> equiponderado, tope de {TARGET_POSITIONS} posiciones, y un valor vendido no puede volver en {QUARANTINE_MONTHS} meses.</li>
        </ul>
        <p className="sr-hint" style={{ marginTop: "var(--sr-sp-3)", lineHeight: 1.7 }}>
          Se mide contra tres referencias, y la tercera es la que de verdad dice si seleccionar aporta algo: el
          S&amp;P 500, su versión equiponderada, y el universo elegible equiponderado. Si a 24 meses queda por
          debajo de esa tercera, se publica el resultado y se cierra el producto.
        </p>
      </section>
    </main>
  );
}
