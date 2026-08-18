"use client";
// /daily — el cierre de mercado, medido.
//
// Es a la vez producto y adquisición: la razón para volver cada día, y una página pública,
// compartible e indexable sin registro. Lo genera el cron `daily-close` de ic-proxy con
// `lib/dailyClose.js`, de forma DETERMINISTA — no hay modelo en el bucle que pueda inventar
// una cifra, así que la promesa "sin números inventados" es estructural aquí, no revisada.
//
// La lectura que lo diferencia de un recap cualquiera no es el adjetivo, es la DISPERSIÓN:
// si el día fue el mercado entero moviéndose a la vez o rotación entre sectores. Es la
// misma pregunta que responde la atribución por acción, a nivel índice.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Sk } from "@/components/ui/Skeleton";

interface SectorRow { etf: string; name: string; changePct: number }
interface Breadth {
  up: number; down: number; total: number;
  dispersion: number; agreement: number;
  kind: "beta" | "rotation" | "broad" | "mixed";
}
interface DailyReport {
  date: string;
  generatedAt: string;
  regime: { id: string | null; previousId: string | null; changed: boolean; confirmed: boolean };
  market: { spyChangePct: number | null; vix: number | null; hyOas: number | null; dgs10: number | null; riskOn: number | null };
  breadth: Breadth | null;
  sectors: SectorRow[];
  leaders: SectorRow[];
  laggards: SectorRow[];
  headline: string;
  context: string;
  gaps: string[];
}
interface Row { close_date: string; payload: DailyReport }

const BREADTH_LABEL: Record<Breadth["kind"], string> = {
  beta: "One-factor day",
  rotation: "Rotation",
  broad: "Broad move",
  mixed: "Split",
};
const BREADTH_NOTE: Record<Breadth["kind"], string> = {
  beta: "Sectors moved together — stock selection had little to work with.",
  rotation: "Money moved between sectors rather than in or out of the market.",
  broad: "Most sectors on the same side, with real spread between them.",
  mixed: "No clean read — the tape disagreed with itself.",
};

const signed = (v: number, dp = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}%`;
const tone = (v: number) => (v >= 0 ? "var(--sr-pos)" : "var(--sr-neg)");

export default function DailyPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    supabase
      .from("sl_daily_close")
      .select("close_date,payload")
      .order("close_date", { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (error || !Array.isArray(data)) setFailed(true);
        else setRows(data as Row[]);
        setLoading(false);
      });
  }, []);

  const rep = rows[idx]?.payload ?? null;

  if (loading) return <div style={{ padding: "var(--sr-sp-6)", maxWidth: 900, margin: "0 auto" }}><Sk w="100%" h={420} /></div>;

  if (failed || !rep) {
    return (
      <div style={{ padding: "var(--sr-sp-6)", maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, marginBottom: "var(--sr-sp-3)" }}>Daily close</h1>
        <div className="card">
          <div className="sr-hint">
            No close published yet. The report is generated after the US market closes on trading days.
          </div>
        </div>
      </div>
    );
  }

  const maxAbs = Math.max(...rep.sectors.map((s) => Math.abs(s.changePct)), 0.01);

  return (
    <div style={{ padding: "var(--sr-sp-6)", maxWidth: 900, margin: "0 auto" }}>
      {/* Header + histórico reciente */}
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-4)", flexWrap: "wrap", gap: "var(--sr-sp-3)" }}>
        <div>
          <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, letterSpacing: "-0.02em" }}>Daily close</h1>
          <div className="sr-hint">{rep.date} · measured, not forecast</div>
        </div>
        {rows.length > 1 && (
          <div style={{ display: "flex", gap: 4, overflowX: "auto" }} role="group" aria-label="Previous closes">
            {rows.slice(0, 6).map((r, i) => (
              <button
                key={r.close_date}
                type="button"
                className={`subtab ${i === idx ? "active" : ""}`}
                aria-pressed={i === idx}
                onClick={() => setIdx(i)}
              >
                {r.close_date.slice(5)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ACTO 1 — macro y titular: lo lee todo el mundo */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        {rep.market.spyChangePct != null && (
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-2)" }}>
            <span className="num" style={{ fontSize: "var(--sr-t-3xl)", fontWeight: 800, color: tone(rep.market.spyChangePct) }}>
              {signed(rep.market.spyChangePct)}
            </span>
            <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>S&amp;P 500</span>
          </div>
        )}
        <p style={{ fontSize: "var(--sr-t-base)", color: "var(--sr-text)", lineHeight: 1.7, margin: 0 }}>{rep.headline}</p>
        {rep.context && <p className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>{rep.context}</p>}
        {rep.regime.changed && (
          <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-amber) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--sr-amber) 30%, transparent)", color: "var(--sr-amber)", fontSize: "var(--sr-t-xs)", fontWeight: 700 }}>
            Regime change: {rep.regime.previousId} → {rep.regime.id}
          </div>
        )}
      </div>

      {/* La lectura diferencial: qué TIPO de día fue */}
      {rep.breadth && (
        <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)" }}>
            <div className="section-label" style={{ margin: 0 }}>What kind of day it was</div>
            <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 800, color: "var(--sr-amber)" }}>
              {BREADTH_LABEL[rep.breadth.kind]}
            </span>
          </div>
          <div className="sr-grid-3">
            <div className="sr-tile">
              <div className="sr-tile-label">Sectors up / down</div>
              <div className="num" style={{ fontSize: "var(--sr-t-md)", fontWeight: 700 }}>{rep.breadth.up}–{rep.breadth.down}</div>
            </div>
            <div className="sr-tile">
              <div className="sr-tile-label">Dispersion</div>
              <div className="num" style={{ fontSize: "var(--sr-t-md)", fontWeight: 700 }}>{rep.breadth.dispersion.toFixed(2)} pp</div>
              <div className="sr-hint">spread between sectors</div>
            </div>
            <div className="sr-tile">
              <div className="sr-tile-label">Agreement</div>
              <div className="num" style={{ fontSize: "var(--sr-t-md)", fontWeight: 700 }}>{(rep.breadth.agreement * 100).toFixed(0)}%</div>
              <div className="sr-hint">on the same side</div>
            </div>
          </div>
          <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>{BREADTH_NOTE[rep.breadth.kind]}</div>
        </div>
      )}

      {/* ACTO 2 — el detalle: quien llega aquí es quien convierte */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
        <div className="section-label">Sectors</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rep.sectors.map((s) => (
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
                {signed(s.changePct, 2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Huecos declarados, no rellenados */}
      {rep.gaps.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div className="sr-hint">Not measured today: {rep.gaps.join(" · ")}.</div>
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
