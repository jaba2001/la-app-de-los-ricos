// Presentación del informe de cierre. Server component a propósito: sin hooks ni estado,
// para que el HTML llegue completo al buscador y al que comparte el enlace.
//
// El navegador de días son enlaces reales (`<Link href="/daily/YYYY-MM-DD">`), no botones
// de estado: cada día tiene URL propia, que es lo que se indexa y se comparte.

import Link from "next/link";
import DailyTracker from "@/components/daily/DailyTracker";
import {
  BREADTH_LABEL, BREADTH_NOTE, signedPct, formatDayLong,
  type DailyReport,
} from "@/lib/dailyClose";

const tone = (v: number) => (v >= 0 ? "var(--sr-pos)" : "var(--sr-neg)");

export default function DailyReportView({
  report, dates, activeDate,
}: { report: DailyReport; dates: string[]; activeDate: string }) {
  const maxAbs = Math.max(...report.sectors.map((s) => Math.abs(s.changePct)), 0.01);
  // `dates` viene ordenado de más reciente a más antiguo.
  const isLatest = dates.length === 0 || dates[0] === activeDate;

  return (
    <div style={{ padding: "var(--sr-sp-6)", maxWidth: 900, margin: "0 auto" }}>
      <DailyTracker
        date={report.date}
        isLatest={isLatest}
        breadthKind={report.breadth?.kind ?? null}
        regimeChanged={report.regime.changed}
      />
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-4)", flexWrap: "wrap", gap: "var(--sr-sp-3)" }}>
        <div>
          <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, letterSpacing: "-0.02em" }}>Daily close</h1>
          <div className="sr-hint">{formatDayLong(report.date)} · measured, not forecast</div>
        </div>
        {dates.length > 1 && (
          <nav style={{ display: "flex", gap: 4, overflowX: "auto" }} aria-label="Previous closes">
            {dates.slice(0, 6).map((d) => (
              <Link
                key={d}
                href={`/daily/${d}`}
                className={`subtab ${d === activeDate ? "active" : ""}`}
                aria-current={d === activeDate ? "page" : undefined}
              >
                {d.slice(5)}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {/* ACTO 1 — macro y titular */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        {report.market.spyChangePct != null && (
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-2)" }}>
            <span className="num" style={{ fontSize: "var(--sr-t-3xl)", fontWeight: 800, color: tone(report.market.spyChangePct) }}>
              {signedPct(report.market.spyChangePct)}
            </span>
            <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>S&amp;P 500</span>
          </div>
        )}
        <p style={{ fontSize: "var(--sr-t-base)", color: "var(--sr-text)", lineHeight: 1.7, margin: 0 }}>{report.headline}</p>
        {report.context && <p className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>{report.context}</p>}
        {report.regime.changed && (
          <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-amber) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--sr-amber) 30%, transparent)", color: "var(--sr-amber)", fontSize: "var(--sr-t-xs)", fontWeight: 700 }}>
            Regime change: {report.regime.previousId} → {report.regime.id}
          </div>
        )}
      </div>

      {/* La lectura diferencial */}
      {report.breadth && (
        <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)" }}>
            <div className="section-label" style={{ margin: 0 }}>What kind of day it was</div>
            <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 800, color: "var(--sr-amber)" }}>
              {BREADTH_LABEL[report.breadth.kind]}
            </span>
          </div>
          <div className="sr-grid-3">
            <div className="sr-tile">
              <div className="sr-tile-label">Sectors up / down</div>
              <div className="num" style={{ fontSize: "var(--sr-t-md)", fontWeight: 700 }}>{report.breadth.up}–{report.breadth.down}</div>
            </div>
            <div className="sr-tile">
              <div className="sr-tile-label">Dispersion</div>
              <div className="num" style={{ fontSize: "var(--sr-t-md)", fontWeight: 700 }}>{report.breadth.dispersion.toFixed(2)} pp</div>
              <div className="sr-hint">spread between sectors</div>
            </div>
            <div className="sr-tile">
              <div className="sr-tile-label">Agreement</div>
              <div className="num" style={{ fontSize: "var(--sr-t-md)", fontWeight: 700 }}>{(report.breadth.agreement * 100).toFixed(0)}%</div>
              <div className="sr-hint">on the same side</div>
            </div>
          </div>
          <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>{BREADTH_NOTE[report.breadth.kind]}</div>
        </div>
      )}

      {/* ACTO 2 — el detalle */}
      {report.sectors.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div className="section-label">Sectors</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {report.sectors.map((s) => (
              <div key={s.etf} style={{ display: "grid", gridTemplateColumns: "150px 1fr 64px", alignItems: "center", gap: "var(--sr-sp-2)" }}>
                <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)" }}>{s.name}</span>
                {/* Barra centrada en cero: el signo se ve antes que el número. */}
                <div style={{ position: "relative", height: 8, background: "var(--sr-surface-2)", borderRadius: 4 }}>
                  <div style={{
                    position: "absolute", top: 0, height: "100%", borderRadius: 4,
                    background: tone(s.changePct),
                    left: s.changePct >= 0 ? "50%" : `${50 - (Math.abs(s.changePct) / maxAbs) * 50}%`,
                    width: `${(Math.abs(s.changePct) / maxAbs) * 50}%`,
                  }} />
                  <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--sr-border-2)" }} />
                </div>
                <span className="num" style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, textAlign: "right", color: tone(s.changePct) }}>
                  {signedPct(s.changePct)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.gaps.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div className="sr-hint">Not measured today: {report.gaps.join(" · ")}.</div>
        </div>
      )}

      {/* Gancho → evidencia → producto */}
      <div className="card">
        <div className="sr-hint" style={{ lineHeight: 1.7 }}>
          Built from measured values by a deterministic template — no model writes these numbers, so
          none can be invented. See how the engine has actually done on{" "}
          <Link href="/track-record" style={{ color: "var(--sr-amber)" }}>the track record</Link>, including
          the backtest we lost, or try the{" "}
          <Link href="/demo" style={{ color: "var(--sr-amber)" }}>live demo</Link> — no signup.
        </div>
      </div>
    </div>
  );
}
