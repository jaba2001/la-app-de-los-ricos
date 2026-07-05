"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { HISTORICAL_BACKTEST as H } from "@/lib/trackRecord";

interface LiveSummary {
  as_of: string | null; months_live: number | null; cohorts: number | null; names_scored: number | null;
  buy_hit_rate: number | null; buy_total_return: number | null; spy_total_return: number | null;
  information_coefficient: number | null; updated_at: string | null;
}

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const clr = (v: number | null | undefined) => (v == null ? "var(--sr-text-3)" : v >= 0 ? "var(--sr-pos)" : "var(--sr-neg)");

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="sr-tile">
      <div className="sr-tile-label">{label}</div>
      <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, color: color ?? "var(--sr-text)" }} className="num">{value}</div>
      {sub && <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function TrackRecordPage() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [live, setLive] = useState<LiveSummary | null>(null);
  const [cohortRows, setCohortRows] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { if (!authLoading && !session) router.replace("/login"); }, [session, authLoading, router]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase.from("sl_track_summary").select("*").eq("id", 1).maybeSingle();
      setLive((data as LiveSummary) ?? null);
      const { count } = await supabase.from("sl_cohort").select("id", { count: "exact", head: true });
      setCohortRows(count ?? 0);
      setLoaded(true);
    })();
  }, [session]);

  if (authLoading || !session) return null;

  const maxDec = Math.max(...H.deciles.map((d) => Math.abs(d)), 1);

  return (
    <div style={{ padding: "var(--sr-sp-6)", maxWidth: 1080, margin: "0 auto" }} className="animate-fade-in">
      <div style={{ marginBottom: "var(--sr-sp-6)" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Track Record</h1>
        <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 6, maxWidth: 680, lineHeight: 1.6 }}>
          The evidence the score works — measured, not asserted. A point-in-time historical backtest
          (below) plus a live forward record that seals an immutable score cohort every month and marks it
          to market weekly. Transparency is the point: here is exactly how it&apos;s measured, caveats included.
        </p>
      </div>

      {/* ── Live forward record ── */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-6)", borderColor: "color-mix(in srgb, var(--sr-amber) 30%, var(--sr-border))" }}>
        <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)" }}>
          <div className="section-label" style={{ margin: 0 }}>Live forward record</div>
          <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: "var(--sr-radius-pill)", background: "color-mix(in srgb, var(--sr-pos) 14%, transparent)", color: "var(--sr-pos)" }}>UN-BACKTESTED</span>
        </div>
        {!loaded ? (
          <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)", padding: "var(--sr-sp-3) 0" }}>Loading…</div>
        ) : live && (live.months_live ?? 0) > 0 ? (
          <div className="sr-grid-4">
            <Stat label="Cohorts sealed" value={String(live.cohorts ?? 0)} sub={`since inception`} />
            <Stat label="BUY hit-rate" value={live.buy_hit_rate != null ? `${(live.buy_hit_rate * 100).toFixed(0)}%` : "—"} sub="beating SPY" />
            <Stat label="BUY avg return" value={pct(live.buy_total_return)} color={clr(live.buy_total_return)} sub={`SPY ${pct(live.spy_total_return)}`} />
            <Stat label="Live IC" value={live.information_coefficient != null ? live.information_coefficient.toFixed(3) : "—"} sub="score ↔ realized" />
          </div>
        ) : (
          <div style={{ color: "var(--sr-text-2)", fontSize: "var(--sr-t-sm)", lineHeight: 1.6 }}>
            <strong style={{ color: "var(--sr-text)" }}>Accumulating.</strong> {cohortRows ? `${cohortRows} scores sealed so far. ` : "The first cohort seals on the next monthly run. "}
            The systematic cron scores the universe on the 2nd of each month and seals an immutable cohort; realized alpha vs SPY is
            measured weekly. In 3–6 months this becomes a clean forward record no one can accuse of overfitting — the complement to the backtest below.
          </div>
        )}
      </div>

      {/* ── Historical backtest ── */}
      <div className="section-label">Historical backtest · {H.period}</div>
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="sr-grid-5" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <Stat label="Score ≥60 return" value={pct(H.equity.buyTotalReturn, 0)} color="var(--sr-pos)" sub={`over ${H.equity.months} months`} />
          <Stat label="SPY return" value={pct(H.equity.spyTotalReturn, 0)} sub="same window" />
          <Stat label="Sharpe (ann.)" value={H.equity.sharpe.toFixed(2)} color="var(--sr-pos)" />
          <Stat label="Max drawdown" value={pct(H.equity.maxDrawdown, 0)} color="var(--sr-neg)" />
          <Stat label="Info. Coefficient" value={H.informationCoefficient.toFixed(3)} sub="Spearman, 3M" />
        </div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", lineHeight: 1.6 }}>
          Equal-weight portfolio of names scoring ≥{H.buyThreshold}, monthly rebalance, net of 10bps/side, across {H.universe} names ({H.mode}) ·
          {H.rebalances} rebalances · {H.nameMonths.toLocaleString()} name-months. Point-in-time fundamentals (SEC EDGAR filing dates), free data.
        </div>
      </div>

      {/* The differentiator — the macro overlay is what beats the market, survivorship-free */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)", borderColor: "color-mix(in srgb, var(--sr-amber) 38%, var(--sr-border))" }}>
        <div className="section-label" style={{ color: "var(--sr-amber)" }}>The edge is the macro↔micro overlay — micro alone doesn&apos;t beat the market</div>
        <div className="sr-grid-3">
          <div className="sr-tile">
            <div className="sr-tile-label">Total return</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num"><span style={{ color: "var(--sr-neg)" }}>{pct(H.microOnly.buyTotalReturn, 0)}</span> → <span style={{ color: "var(--sr-amber)" }}>{pct(H.equity.buyTotalReturn, 0)}</span></div>
            <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2 }}>micro-only (&lt;SPY) → full score (&gt;SPY {pct(H.equity.spyTotalReturn, 0)})</div>
          </div>
          <div className="sr-tile">
            <div className="sr-tile-label">Sharpe (ann.)</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num">{H.microOnly.sharpe.toFixed(2)} → <span style={{ color: "var(--sr-pos)" }}>{H.equity.sharpe.toFixed(2)}</span></div>
          </div>
          <div className="sr-tile">
            <div className="sr-tile-label">Max drawdown</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num">{pct(H.microOnly.maxDrawdown, 0)} → <span style={{ color: "var(--sr-pos)" }}>{pct(H.equity.maxDrawdown, 0)}</span></div>
            <div style={{ fontSize: "10px", color: "var(--sr-pos)", marginTop: 2 }}>~40% smaller</div>
          </div>
        </div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", marginTop: "var(--sr-sp-3)", lineHeight: 1.6 }}>
          On a survivorship-free test the raw value/quality score <strong>lags the mega-cap tape</strong> (+112% vs SPY +154%). Feeding the current macro regime (the production engine, point-in-time) into the score is what flips it to a win — <strong>+157.5% vs +154.2%, Sharpe 0.98, half the drawdown</strong>. Scora&apos;s differentiator isn&apos;t the stock score; it&apos;s the macro↔micro integration — the regime lens telling you <em>when</em> to lean in.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-5)" }}>
        {/* By horizon */}
        <div className="card">
          <div className="section-label">Alpha vs SPY, by horizon</div>
          <table className="sr-table">
            <thead><tr><th>Horizon</th><th style={{ textAlign: "right" }}>BUY α</th><th style={{ textAlign: "right" }}>BUY hit</th><th style={{ textAlign: "right" }}>rest α</th></tr></thead>
            <tbody>
              {H.horizons.map((h) => (
                <tr key={h.label}>
                  <td style={{ fontWeight: 600 }}>{h.label}</td>
                  <td style={{ textAlign: "right", color: clr(h.buyAlpha), fontWeight: 700 }} className="num">{pct(h.buyAlpha)}</td>
                  <td style={{ textAlign: "right" }} className="num">{h.buyHit}%</td>
                  <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{pct(h.restAlpha)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Decile monotonicity */}
        <div className="card">
          <div className="section-label">3M alpha by score decile</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120, marginTop: "var(--sr-sp-3)" }}>
            {H.deciles.map((d, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }} title={`D${i + 1}: ${pct(d)}`}>
                <div style={{ height: `${(Math.abs(d) / maxDec) * 50}%`, background: d >= 0 ? "var(--sr-pos)" : "var(--sr-neg)", borderRadius: "2px 2px 0 0", alignSelf: d >= 0 ? "stretch" : "stretch", marginTop: d >= 0 ? "auto" : 0, opacity: 0.35 + 0.65 * (i / 9) }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--sr-text-3)", marginTop: 6 }}>
            <span>D1 (low score)</span><span>D10 (high)</span>
          </div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", marginTop: 8 }}>
            Top-minus-bottom decile spread: <strong style={{ color: clr(H.topMinusBottom) }}>{pct(H.topMinusBottom)}</strong> — on this broad universe fine-grained ranking is roughly flat; the signal is in the BUY-vs-rest cut, not the deciles.
          </div>
        </div>
      </div>

      {/* By regime */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="section-label">Score ≥60 · 3M alpha by macro regime</div>
        <div className="sr-grid-4">
          {H.regimes.map((r) => (
            <div key={r.label} className="sr-tile">
              <div className="sr-tile-label">{r.label}</div>
              <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: clr(r.alpha) }} className="num">{r.alpha == null ? "—" : pct(r.alpha)}</div>
              <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2 }}>{r.months} months</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-3)" }}>
          Regime is a simplified as-of FRED classifier used to label periods only — it is not fed into the score.
        </div>
      </div>

      {/* Caveats — honesty is the product */}
      <div className="card" style={{ borderColor: "color-mix(in srgb, var(--sr-warn) 25%, var(--sr-border))" }}>
        <div className="section-label" style={{ color: "var(--sr-warn)" }}>Caveats — read these</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.7 }}>
          {H.caveats.map((c, i) => <li key={i} style={{ marginBottom: 6 }}>{c}</li>)}
        </ul>
      </div>

      <div style={{ textAlign: "right", fontSize: "10px", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-4)" }}>
        Backtest via SEC EDGAR (point-in-time) + FMP + FRED · methodology open · re-run from research/backtest.mjs
      </div>
    </div>
  );
}
