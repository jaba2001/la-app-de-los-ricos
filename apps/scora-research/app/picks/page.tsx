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
  positionReturn, universeSnapshots, CLOSE_REASON_LABEL, type PickPosition,
} from "@/lib/picksData";
import {
  PICKS_RULES_VERSION, TARGET_POSITIONS, BUYS_PER_DATE,
  ENTRY_PCTL, EXIT_PCTL, PERSISTENCE_DAYS, QUARANTINE_MONTHS,
} from "@/lib/picks";
import { tServidor } from "@/lib/i18n/servidor";
import TransServidor from "@/components/TransServidor";

// Por petición, no ISR (12-10-2026): el build de Docker no tiene base de datos, así que la
// versión pre-renderizada salía VACÍA («no hay datos») y era la que veía el primer visitante
// tras cada despliegue — en producción, durante días. Son dos consultas pequeñas.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scora Picks",
  description:
    "A portfolio run by mechanical rules, identical for everyone, with every decision published — including the dates with no buys and every position that went wrong.",
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
  const t = await tServidor();
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
  const fotos = universeSnapshots(runs);

  return (
    <main className="container" style={{ paddingBottom: "var(--sr-sp-6)" }}>
      <div style={{ marginBottom: "var(--sr-sp-4)" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, letterSpacing: "-0.02em" }}>{t("Scora Picks")}</h1>
        <div className="sr-hint">
          {t(`Fixed rules, no emotion and no hindsight · version ${PICKS_RULES_VERSION} · measured live from day one`)}</div>
      </div>

      {/* Lo primero que se lee, y va antes que cualquier número. */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)", borderLeft: "3px solid var(--sr-warn, #b45309)" }}>
        <p style={{ margin: 0, fontSize: "var(--sr-t-sm)", lineHeight: 1.7 }}>
          <TransServidor text={"<s1>This is not investment advice or a return forecast.</s1> It is what a system of rules written in advance does, published in full: the parts that work and the parts that don't. The rules were designed by looking at historical data, so their backtest <s2>is not out-of-sample evidence</s2> — it is the reason to test them live, not proof that they work. This track record starts from zero and will only have something to say after 24 months."} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} /></p>
        <p style={{ margin: "var(--sr-sp-2) 0 0", fontSize: "var(--sr-t-sm)", lineHeight: 1.7 }}>
          <TransServidor text={"<s1>And a correction from August 24, 2026, which goes here and not in a footnote.</s1> An audit of the data engine found three defects affecting four of the five metrics used to select. Fixed and re-measured, the signal <s2>no longer beats the equal-weighted eligible universe in both historical windows</s2>: it wins in one and loses in the other. Before, it won in both, and that difference was the defect, not the market. Nor can we keep saying the portfolio falls less than the index: in the recent window it falls <s3>more</s3>. No rule has been changed —changing one now would mean choosing it by looking at the result— but the earlier evidence is weaker than what was published, which is all the more reason why the only thing that will count is what happens here, live."} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} s3={(c) => <strong>{c}</strong>} /></p>
        <p style={{ margin: "var(--sr-sp-2) 0 0", fontSize: "var(--sr-t-sm)", lineHeight: 1.7 }}>
          <TransServidor text={"<s1>And the most uncomfortable part, which also goes here:</s1> the shutdown criterion is published in advance —if after 24 months it is below its benchmark, the result is published and it shuts down—. Applied to the two historical windows, <s2>that criterion would have fired in one of the two</s2>. It is not being relaxed: relaxing a criterion after seeing the result is what empties it of meaning. But anyone putting time or money into this should start from the assumption that <s3>the probability it ends in shutdown is high</s3>, and it was before it started."} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} s3={(c) => <strong>{c}</strong>} /></p>
      </div>

      {!arrancado ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            <strong>{t("No decisions published yet.")}</strong>
          </p>
          <p className="sr-hint" style={{ marginTop: "var(--sr-sp-2)", lineHeight: 1.7 }}>
            <TransServidor text={`The system decides on the 1st and the 15th of each month. For the first six weeks the portfolio stays <s1>empty on purpose</s1>: the persistence rule requires a stock to spend ${PERSISTENCE_DAYS} days above the threshold before it can enter, and that history has to build up. Buying ${BUYS_PER_DATE * 2} a month, filling the ${TARGET_POSITIONS} positions takes about ten months.`} s1={(c) => <strong>{c}</strong>} /></p>
        </div>
      ) : (
        <>
          <div className="sr-grid-4" style={{ marginBottom: "var(--sr-sp-4)" }}>
            <Tile label={t("Open positions")} value={`${open.length}/${TARGET_POSITIONS}`} sub={open.length < TARGET_POSITIONS ? t("the portfolio is still being built") : t("portfolio full")} />
            <Tile label={t("Closed positions")} value={String(closed.length)} sub={cerradasConRetorno.length ? t(`${aciertos} positive`) : t("no exits yet")} />
            <Tile label={t("Average return at exit")} value={pct(mediaCerradas)} color={tone(mediaCerradas)} sub={t("simple, unweighted")} />
            <Tile label={t("Dates with no buys")} value={`${sinCompra}/${runs.length}`} sub={t("an empty slot is a result")} />
          </div>

          <section style={{ marginBottom: "var(--sr-sp-5)" }}>
            <h2 style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, marginBottom: "var(--sr-sp-2)" }}>{t("The whole portfolio")}</h2>
            {open.length === 0 ? (
              <p className="sr-hint">{t("No open positions right now.")}</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="sr-table">
                  <thead>
                    <tr><th>{t("Stock")}</th><th>{t("Since")}</th><th>{t("Percentile at entry")}</th><th>{t("Entry price")}</th></tr>
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
            <h2 style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, marginBottom: "var(--sr-sp-2)" }}>{t("Every closed position")}</h2>
            <p className="sr-hint" style={{ marginBottom: "var(--sr-sp-2)" }}>
              {t(`All ${closed.length} that were sold, with their result and their reason. No exceptions: publishing only the winners is what makes the industry's track records worthless.`)}</p>
            {closed.length === 0 ? (
              <p className="sr-hint">{t("No position has been closed yet.")}</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="sr-table">
                  <thead>
                    <tr><th>{t("Stock")}</th><th>{t("Bought")}</th><th>{t("Sold")}</th><th>{t("Return")}</th><th>{t("Why it was sold")}</th></tr>
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
                          <td className="sr-hint">{t(CLOSE_REASON_LABEL[p.close_reason ?? ""] ?? p.close_reason ?? "—")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={{ marginBottom: "var(--sr-sp-5)" }}>
            <h2 style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, marginBottom: "var(--sr-sp-2)" }}>{t("Every decision, including the ones not to buy")}</h2>
            <p className="sr-hint" style={{ marginBottom: "var(--sr-sp-2)" }}>
              {t("The system looks on the 1st and the 15th. If nothing meets the rules, it doesn't buy — and that date still appears here. Without these rows, a day with no buys would be indistinguishable from a stalled system.")}</p>
            <div style={{ overflowX: "auto" }}>
              <table className="sr-table">
                <thead>
                  <tr><th>{t("Date")}</th><th>{t("Universe")}</th><th>{t("Eligible")}</th><th>{t("Buys")}</th><th>{t("Sells")}</th><th>{t("Portfolio")}</th></tr>
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
            {fotos.length > 0 && (
              <p className="sr-hint" style={{ marginTop: "var(--sr-sp-2)", lineHeight: 1.7 }}>
                <TransServidor text={"<s1>Which universe each decision used:</s1> the S&P 500 membership list used in each decision was the one from"} s1={(c) => <strong>{c}</strong>} />{" "}
                {fotos.length === 1 ? fotos[0] : fotos.join(", ")}<TransServidor text={", and it is stored with the decision so it can be checked later. <s1>Until August 24, 2026 that snapshot had been frozen for 366 days</s1>, because the historical source stopped updating and this page said — wrongly — that there was no substitute: the candidates reviewed seemed to carry wrong tickers, and it turned out they were the <s2>current</s2> tickers, checked one by one against SEC records. Fixed: the snapshot is now current. Decisions taken before that date used the August 2025 index and are not rewritten."} s1={(c) => <strong>{c}</strong>} s2={(c) => <em>{c}</em>} /></p>
            )}
          </section>
        </>
      )}

      <section className="card">
        <h2 style={{ fontSize: "var(--sr-t-md)", fontWeight: 700, marginBottom: "var(--sr-sp-2)" }}>{t("The rules, in five lines")}</h2>
        <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "var(--sr-t-sm)", lineHeight: 1.8 }}>
          <li><TransServidor text={`<s1>What gets bought:</s1> S&P 500 stocks in the top ${(ENTRY_PCTL * 100).toFixed(0)}% by quality — gross profitability on assets, ROIC, operating margin, interest coverage and net debt. All from the financial statements; nothing from the price.`} s1={(c) => <strong>{c}</strong>} /></li>
          <li><TransServidor text={`<s1>When:</s1> the first business day and the 15th, ${BUYS_PER_DATE} stocks each time. Fixed dates: not brought forward because the market falls, not delayed because it "looks expensive".`} s1={(c) => <strong>{c}</strong>} /></li>
          <li><TransServidor text={`<s1>Persistence:</s1> the threshold must be met ${PERSISTENCE_DAYS} days in a row. Without it you buy a one-day spike.`} s1={(c) => <strong>{c}</strong>} /></li>
          <li><TransServidor text={`<s1>When it sells:</s1> if the signal falls below the ${(EXIT_PCTL * 100).toFixed(0)}th percentile in two evaluations in a row, if a pillar enters the bottom decile of its sector, or if it stops meeting the universe. <s2>There is no price stop-loss</s2>: a stop is a rule about the price, not about the business.`} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} /></li>
          <li><TransServidor text={`<s1>Weights:</s1> equal-weighted, capped at ${TARGET_POSITIONS} positions, and a stock that is sold can't return for ${QUARANTINE_MONTHS} months.`} s1={(c) => <strong>{c}</strong>} /></li>
        </ul>
        <p className="sr-hint" style={{ marginTop: "var(--sr-sp-3)", lineHeight: 1.7 }}>
          <TransServidor text={"<s1>This portfolio holds no banks, and that is not an opinion about banking.</s1> The quality metrics —operating margin, interest coverage, net debt to EBITDA— mean nothing on a bank's balance sheet, where interest is the business and not an expense. Measured: of the 18 largest banks in the index, <s2>none</s2> gets a score. There are no REITs either, for the same kind of reason. It is a permanent sector bias that comes with the product — and it is worth knowing that in both backtest windows banks underperformed the index, so not holding them helped. How much of the historical edge is that and how much is selection <s3>has not been measured yet</s3>. Since 2026-08-23 there is a bank-specific metric set —net interest margin, efficiency, fee share, deposits to assets—, and public data has been checked to support it for the index's 20 commercial banks. What it does <s4>not</s4> support is credit quality (40%) or regulatory capital (30%), so those two aren't computed: ranking by a metric that only exists for 40% is ranking data availability. None of that enters this portfolio yet: adding banks changes the strategy, it doesn't fix a bug, and that requires opening a new rules version and validating it first."} s1={(c) => <strong>{c}</strong>} s2={(c) => <strong>{c}</strong>} s3={(c) => <strong>{c}</strong>} s4={(c) => <em>{c}</em>} /></p>
        <p className="sr-hint" style={{ marginTop: "var(--sr-sp-3)", lineHeight: 1.7 }}>
          {t("It is measured against three benchmarks, and the third is the one that really tells whether selection adds anything: the S&P 500, its equal-weighted version, and the equal-weighted eligible universe. If after 24 months it is below that third one, the result is published and the product is shut down.")}</p>
      </section>
    </main>
  );
}
