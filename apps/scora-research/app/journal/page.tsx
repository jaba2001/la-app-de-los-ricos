"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { datos } from "@/lib/dataClient";
import { useAuth } from "@/lib/auth";
import { authedFetch } from "@/lib/proxy";
import { track } from "@/lib/analytics";
import PortfolioOptimizer from "@/components/journal/PortfolioOptimizer";
import ExposureAudit from "@/components/journal/ExposureAudit";
import FactorExposure from "@/components/journal/FactorExposure";
import PositionSizer from "@/components/journal/PositionSizer";
import { t as tr, tv } from "@/lib/i18n/cliente";

interface JournalTrade {
  id: number; ticker: string; side: string; shares: number; price: number;
  trade_date: string; thesis: string | null; sector: string | null;
  status: string; exit_price: number | null; exit_date: string | null; created_at: string;
}

function Sk({ h = 14, w = "100%" }: { h?: number; w?: string }) {
  return <div style={{ width: w, height: h, borderRadius: 4, background: "var(--sr-surface-3)", animation: "pulse 1.5s ease-in-out infinite" }} />;
}
function money(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  const s = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(2)}`;
}
const pnlColor = (n: number) => n > 0 ? "var(--sr-pos)" : n < 0 ? "var(--sr-neg)" : "var(--sr-text-3)";

/** Directional P&L: buy profits when price rises, sell (short) when it falls. */
function unrealized(t: JournalTrade, mark: number): number {
  const dir = t.side === "sell" ? -1 : 1;
  return (mark - t.price) * t.shares * dir;
}
function realized(t: JournalTrade): number {
  if (t.exit_price == null) return 0;
  const dir = t.side === "sell" ? -1 : 1;
  return (t.exit_price - t.price) * t.shares * dir;
}

export default function JournalPage() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [trades, setTrades] = useState<JournalTrade[]>([]);
  const [marks, setMarks] = useState<Record<string, number>>({});
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMarks, setLoadingMarks] = useState(false);
  const [error, setError] = useState("");

  // Add-trade form
  const [f, setF] = useState({ ticker: "", side: "buy", shares: "", price: "", trade_date: new Date().toISOString().slice(0, 10), thesis: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !session) router.replace("/login");
  }, [session, authLoading, router]);

  const load = useCallback(async () => {
    if (!session) return;
    setLoadingList(true);
    const { data, error } = await datos
      .from("sl_journal")
      .select("*")
      .eq("user_id", session.user.id)
      .order("trade_date", { ascending: false });
    if (error) setError(error.message);
    else setTrades((data ?? []) as JournalTrade[]);
    setLoadingList(false);
  }, [session]);

  useEffect(() => { load(); }, [load]);

  // Live marks for every ticker with an OPEN position.
  useEffect(() => {
    const open = Array.from(new Set(trades.filter(t => t.status === "open").map(t => t.ticker)));
    if (open.length === 0) { setMarks({}); return; }
    setLoadingMarks(true);
    Promise.allSettled(open.map(async ticker => {
      const res = await authedFetch<Record<string, unknown>[]>(`/api/fmp/quote?symbol=${ticker}`);
      const raw = Array.isArray(res) ? res[0] : null;
      return { ticker, price: raw?.price != null ? Number(raw.price) : null };
    })).then(rs => {
      const map: Record<string, number> = {};
      rs.forEach(r => { if (r.status === "fulfilled" && r.value.price != null) map[r.value.ticker] = r.value.price; });
      setMarks(map);
      setLoadingMarks(false);
    }).catch(() => setLoadingMarks(false));
  }, [trades]);

  async function addTrade() {
    if (!session) return;
    const ticker = f.ticker.trim().toUpperCase();
    const shares = Number(f.shares);
    const price = Number(f.price);
    if (!ticker || !(shares > 0) || !(price >= 0)) { setError(tr("Ticker, shares (>0) and price are required.")); return; }
    setSaving(true); setError("");
    const { error } = await datos.from("sl_journal").insert({
      user_id: session.user.id,
      ticker, side: f.side, shares, price,
      trade_date: f.trade_date || new Date().toISOString().slice(0, 10),
      thesis: f.thesis.trim() || null,
    });
    if (error) setError(error.message);
    else { track("journal_trade_added", { side: f.side, has_thesis: !!f.thesis.trim() }); setF({ ...f, ticker: "", shares: "", price: "", thesis: "" }); await load(); }
    setSaving(false);
  }

  async function closeTrade(t: JournalTrade) {
    const mark = marks[t.ticker];
    if (mark == null) { setError(tr(`No live price for ${t.ticker} yet — try again in a moment.`)); return; }
    const { error } = await datos.from("sl_journal")
      .update({ status: "closed", exit_price: mark, exit_date: new Date().toISOString().slice(0, 10) })
      .eq("id", t.id);
    if (error) setError(error.message);
    else await load();
  }

  async function removeTrade(id: number) {
    const { error } = await datos.from("sl_journal").delete().eq("id", id);
    if (error) setError(error.message);
    else setTrades(prev => prev.filter(t => t.id !== id));
  }

  if (authLoading || !session) return null;

  const openTrades = trades.filter(t => t.status === "open");
  const closedTrades = trades.filter(t => t.status === "closed");

  // Portfolio summary
  const costBasis = openTrades.reduce((s, t) => s + t.price * t.shares, 0);
  const marketValue = openTrades.reduce((s, t) => s + (marks[t.ticker] != null ? marks[t.ticker] * t.shares : t.price * t.shares), 0);
  const unrealTotal = openTrades.reduce((s, t) => s + (marks[t.ticker] != null ? unrealized(t, marks[t.ticker]) : 0), 0);
  const realTotal = closedTrades.reduce((s, t) => s + realized(t), 0);

  // Attribution by thesis (unrealized + realized)
  const byThesis: Record<string, { pnl: number; cost: number }> = {};
  for (const t of openTrades) {
    const key = t.thesis || "— (untagged)";
    (byThesis[key] ??= { pnl: 0, cost: 0 });
    byThesis[key].pnl += marks[t.ticker] != null ? unrealized(t, marks[t.ticker]) : 0;
    byThesis[key].cost += t.price * t.shares;
  }
  for (const t of closedTrades) {
    const key = t.thesis || "— (untagged)";
    (byThesis[key] ??= { pnl: 0, cost: 0 });
    byThesis[key].pnl += realized(t);
    byThesis[key].cost += t.price * t.shares;
  }
  const thesisRows = Object.entries(byThesis).sort((a, b) => b[1].pnl - a[1].pnl);

  const inputStyle: React.CSSProperties = {
    padding: "var(--sr-sp-2) var(--sr-sp-3)", background: "var(--sr-surface)",
    border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)",
    color: "var(--sr-text)", fontSize: "var(--sr-t-sm)", outline: "none", fontFamily: "inherit",
  };

  return (
    <div style={{ padding: "var(--sr-sp-5)", maxWidth: 1040, margin: "0 auto" }}>
      <div style={{ marginBottom: "var(--sr-sp-5)" }}>
        <h1 style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, letterSpacing: "-0.02em" }}>{tr("Trade Journal")}</h1>
        <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", marginTop: 4 }}>
          {tr("Log your real trades, group them by thesis, and track live P&L. Your own book — separate from the paper fund.")}</p>
      </div>

      {/* Summary tiles */}
      <div className="sr-grid-4" style={{ marginBottom: "var(--sr-sp-5)" }}>
        {[
          { label: "Open cost basis", value: money(costBasis), color: "var(--sr-text)" },
          { label: "Market value", value: loadingMarks ? "…" : money(marketValue), color: "var(--sr-text)" },
          { label: "Unrealized P&L", value: loadingMarks ? "…" : `${unrealTotal >= 0 ? "+" : ""}${money(unrealTotal)}`, color: pnlColor(unrealTotal), sub: costBasis > 0 ? `${((unrealTotal / costBasis) * 100).toFixed(1)}%` : undefined },
          { label: "Realized P&L", value: `${realTotal >= 0 ? "+" : ""}${money(realTotal)}`, color: pnlColor(realTotal) },
        ].map(t => (
          <div key={t.label} className="sr-tile">
            <div className="sr-tile-label">{tv(t.label)}</div>
            <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: t.color }} className="num">{t.value}</div>
            {t.sub && <div className="sr-hint">{tv(t.sub)}</div>}
          </div>
        ))}
      </div>

      {/* Add trade */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="section-label">{tr("Log a trade")}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-2)", alignItems: "center" }}>
          <input style={{ ...inputStyle, width: 90 }} placeholder={tr("Ticker")} value={f.ticker} onChange={e => setF({ ...f, ticker: e.target.value.toUpperCase() })} />
          <select style={{ ...inputStyle, width: 84 }} value={f.side} onChange={e => setF({ ...f, side: e.target.value })}>
            <option value="buy">{tr("Buy")}</option>
            <option value="sell">{tr("Sell")}</option>
          </select>
          <input style={{ ...inputStyle, width: 90 }} type="number" placeholder={tr("Shares")} value={f.shares} onChange={e => setF({ ...f, shares: e.target.value })} />
          <input style={{ ...inputStyle, width: 100 }} type="number" placeholder={tr("Price $")} value={f.price} onChange={e => setF({ ...f, price: e.target.value })} />
          <input style={{ ...inputStyle, width: 140 }} type="date" value={f.trade_date} onChange={e => setF({ ...f, trade_date: e.target.value })} />
          <input style={{ ...inputStyle, flex: 1, minWidth: 160 }} placeholder={tr("Thesis / tag (optional)")} value={f.thesis} onChange={e => setF({ ...f, thesis: e.target.value })} onKeyDown={e => e.key === "Enter" && addTrade()} />
          <button className="btn-primary" onClick={addTrade} disabled={saving} style={{ flexShrink: 0 }}>{saving ? "…" : tr("Add trade")}</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "var(--sr-sp-3) var(--sr-sp-4)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-sm)", marginBottom: "var(--sr-sp-4)" }}>{error}</div>
      )}

      {/* Open positions */}
      <div className="card" style={{ padding: 0, marginBottom: "var(--sr-sp-5)" }}>
        <div className="section-label" style={{ padding: "var(--sr-sp-4) var(--sr-sp-4) 0" }}>{tr("Open positions")}</div>
        {loadingList ? <div style={{ padding: "var(--sr-sp-4)" }}><Sk h={80} /></div> : openTrades.length === 0 ? (
          <div style={{ padding: "var(--sr-sp-6)", textAlign: "center", color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>{tr("No open positions. Log a trade above.")}</div>
        ) : (
          <table className="sr-table">
            <thead><tr>
              <th>{tr("Ticker")}</th><th>{tr("Side")}</th><th style={{ textAlign: "right" }}>{tr("Shares")}</th>
              <th style={{ textAlign: "right" }}>{tr("Entry")}</th><th style={{ textAlign: "right" }}>{tr("Mark")}</th>
              <th style={{ textAlign: "right" }}>{tr("Unreal. P&L")}</th><th>{tr("Thesis")}</th><th>{tr("Date")}</th><th></th>
            </tr></thead>
            <tbody>
              {openTrades.map(t => {
                const mark = marks[t.ticker];
                const pnl = mark != null ? unrealized(t, mark) : null;
                const pct = mark != null && t.price > 0 ? ((mark - t.price) / t.price) * 100 * (t.side === "sell" ? -1 : 1) : null;
                return (
                  <tr key={t.id}>
                    <td><Link href={`/stock/${t.ticker}`} style={{ fontWeight: 700, color: "var(--sr-amber)", textDecoration: "none" }} className="num">{t.ticker}</Link></td>
                    <td style={{ color: t.side === "sell" ? "var(--sr-neg)" : "var(--sr-pos)", fontWeight: 600, textTransform: "capitalize" }}>{t.side}</td>
                    <td style={{ textAlign: "right" }} className="num">{t.shares.toLocaleString("en-US")}</td>
                    <td style={{ textAlign: "right" }} className="num">${t.price.toFixed(2)}</td>
                    <td style={{ textAlign: "right" }} className="num">{loadingMarks && mark == null ? "…" : mark != null ? `$${mark.toFixed(2)}` : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 600, color: pnl != null ? pnlColor(pnl) : "var(--sr-text-3)" }} className="num">
                      {pnl != null ? `${pnl >= 0 ? "+" : ""}${money(pnl)}` : "—"}
                      {pct != null && <span style={{ fontSize: "var(--sr-t-xs)", marginLeft: 4, opacity: 0.8 }}>({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)</span>}
                    </td>
                    <td style={{ color: "var(--sr-text-2)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.thesis ?? "—"}</td>
                    <td style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-xs)" }}>{t.trade_date}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button onClick={() => closeTrade(t)} title={tr("Close at market")} style={{ background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)", color: "var(--sr-text-2)", cursor: "pointer", padding: "3px 8px", fontSize: "var(--sr-t-xs)", marginRight: 4 }}>{tr("Close")}</button>
                      <button onClick={() => removeTrade(t.id)} title={tr("Delete")} style={{ background: "none", border: "none", color: "var(--sr-text-3)", cursor: "pointer", padding: "2px 6px", fontSize: "var(--sr-t-base)" }}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Exposure & concentration audit */}
      {openTrades.length > 0 && (
        <ExposureAudit trades={openTrades.map(t => ({ ticker: t.ticker, shares: t.shares, price: t.price, thesis: t.thesis, sector: t.sector }))} marks={marks} />
      )}

      {/* Factor X-ray (APT): concentración por FACTOR, no por sector. Va justo detrás de la
          auditoría por sector a propósito — el contraste entre las dos es el hallazgo. */}
      {openTrades.length > 0 && (
        <FactorExposure positions={openTrades.map(t => ({
          ticker: t.ticker,
          value: (marks[t.ticker] != null ? marks[t.ticker] : t.price) * t.shares,
        }))} />
      )}

      {/* Position sizing calculator */}
      <PositionSizer />

      {/* Portfolio optimizer (P2-13) */}
      {openTrades.length > 0 && (
        <PortfolioOptimizer tickers={Array.from(new Set(openTrades.map(t => t.ticker.toUpperCase())))} />
      )}

      {/* Attribution by thesis */}
      {thesisRows.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
          <div className="section-label">{tr("Attribution by thesis")}</div>
          <table className="sr-table">
            <thead><tr><th>{tr("Thesis")}</th><th style={{ textAlign: "right" }}>{tr("Cost basis")}</th><th style={{ textAlign: "right" }}>{tr("P&L (unreal.+real.)")}</th><th style={{ textAlign: "right" }}>{tr("Return")}</th></tr></thead>
            <tbody>
              {thesisRows.map(([thesis, v]) => (
                <tr key={thesis}>
                  <td style={{ fontWeight: 600 }}>{thesis}</td>
                  <td style={{ textAlign: "right" }} className="num">{money(v.cost)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: pnlColor(v.pnl) }} className="num">{v.pnl >= 0 ? "+" : ""}{money(v.pnl)}</td>
                  <td style={{ textAlign: "right", color: pnlColor(v.pnl) }} className="num">{v.cost > 0 ? `${(v.pnl / v.cost * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Closed trades */}
      {closedTrades.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="section-label" style={{ padding: "var(--sr-sp-4) var(--sr-sp-4) 0" }}>{tr("Closed trades")}</div>
          <table className="sr-table">
            <thead><tr>
              <th>{tr("Ticker")}</th><th>{tr("Side")}</th><th style={{ textAlign: "right" }}>{tr("Shares")}</th>
              <th style={{ textAlign: "right" }}>{tr("Entry")}</th><th style={{ textAlign: "right" }}>{tr("Exit")}</th>
              <th style={{ textAlign: "right" }}>{tr("Realized P&L")}</th><th>{tr("Thesis")}</th><th>{tr("Closed")}</th><th></th>
            </tr></thead>
            <tbody>
              {closedTrades.map(t => {
                const pnl = realized(t);
                return (
                  <tr key={t.id}>
                    <td><Link href={`/stock/${t.ticker}`} style={{ fontWeight: 700, color: "var(--sr-amber)", textDecoration: "none" }} className="num">{t.ticker}</Link></td>
                    <td style={{ color: t.side === "sell" ? "var(--sr-neg)" : "var(--sr-pos)", fontWeight: 600, textTransform: "capitalize" }}>{t.side}</td>
                    <td style={{ textAlign: "right" }} className="num">{t.shares.toLocaleString("en-US")}</td>
                    <td style={{ textAlign: "right" }} className="num">${t.price.toFixed(2)}</td>
                    <td style={{ textAlign: "right" }} className="num">{t.exit_price != null ? `$${t.exit_price.toFixed(2)}` : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 600, color: pnlColor(pnl) }} className="num">{pnl >= 0 ? "+" : ""}{money(pnl)}</td>
                    <td style={{ color: "var(--sr-text-2)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.thesis ?? "—"}</td>
                    <td style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-xs)" }}>{t.exit_date ?? "—"}</td>
                    <td><button onClick={() => removeTrade(t.id)} title={tr("Delete")} style={{ background: "none", border: "none", color: "var(--sr-text-3)", cursor: "pointer", padding: "2px 6px", fontSize: "var(--sr-t-base)" }}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
