"use client";
import { useEffect, useState, useCallback } from "react";
import { datos } from "@/lib/dataClient";
import { useAuth } from "@/lib/auth";
import { track } from "@/lib/analytics";
import { Sk } from "@/components/ui/Skeleton";

interface TechState { aboveSma150: boolean; stage: number; baseBreakout: boolean; }
interface Props {
  ticker: string;
  price: number | null;
  ratingLabel?: string | null;   // current Scora rating (for rating_buy eval)
  rdcfUpside?: number | null;     // reverse-DCF upside % (for rdcf_cheap eval)
  tech?: TechState | null;        // technical state (for crossed_sma150 / base_breakout eval)
}

interface Alert {
  id: number; ticker: string; kind: string; threshold: number | null;
  note: string | null; active: boolean; last_triggered_at: string | null; last_value: number | null;
  one_shot: boolean;
}

const KIND_LABEL: Record<string, string> = {
  price_above: "Price rises above",
  price_below: "Price falls below",
  rating_buy: "Scora rating turns Buy",
  rdcf_cheap: "Reverse-DCF says cheap",
  crossed_sma150: "Price above 150-day MA",
  base_breakout: "Base breakout (volume-confirmed)",
  stage_change: "Trend stage changes",
};

/** In-app evaluation: is this alert's condition met right now, given live inputs? stage_change is
 *  a transition the cron detects (needs the prior stage), so it isn't lit live here. */
function isTriggeredNow(a: Alert, price: number | null, ratingLabel?: string | null, rdcfUpside?: number | null, tech?: TechState | null): boolean {
  switch (a.kind) {
    case "price_above": return price != null && a.threshold != null && price >= a.threshold;
    case "price_below": return price != null && a.threshold != null && price <= a.threshold;
    case "rating_buy":  return !!ratingLabel && /buy/i.test(ratingLabel);
    case "rdcf_cheap":  return rdcfUpside != null && rdcfUpside > 0;
    case "crossed_sma150": return tech?.aboveSma150 === true;
    case "base_breakout":  return tech?.baseBreakout === true;
    default: return false;
  }
}

export default function AlertConfig({ ticker, price, ratingLabel, rdcfUpside, tech }: Props) {
  const { session } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState("price_above");
  const [threshold, setThreshold] = useState("");
  const [oneShot, setOneShot] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const { data, error } = await datos.from("sl_alerts")
      .select("id,ticker,kind,threshold,note,active,last_triggered_at,last_value,one_shot")
      .eq("user_id", session.user.id).eq("ticker", ticker.toUpperCase())
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setAlerts((data ?? []) as Alert[]);
    setLoading(false);
  }, [session, ticker]);

  useEffect(() => { load(); }, [load]);

  const needsThreshold = kind === "price_above" || kind === "price_below";

  async function addAlert() {
    if (!session) return;
    const thr = needsThreshold ? Number(threshold) : null;
    if (needsThreshold && !(thr != null && thr > 0)) { setError("Enter a positive price threshold."); return; }
    // Dedupe: don't let the user stack an identical active alert.
    if (alerts.some(a => a.active && a.kind === kind && (a.threshold ?? null) === (thr ?? null))) {
      setError("You already have that alert on this ticker."); return;
    }
    setError("");
    const { error } = await datos.from("sl_alerts").insert({
      user_id: session.user.id, ticker: ticker.toUpperCase(), kind, threshold: thr, active: true, one_shot: oneShot,
    });
    if (error) setError(error.message);
    else { track("alert_created", { kind, one_shot: oneShot, has_threshold: thr != null }); setThreshold(""); await load(); }
  }

  async function toggleActive(a: Alert) {
    const { error } = await datos.from("sl_alerts").update({ active: !a.active }).eq("id", a.id);
    if (error) setError(error.message); else await load();
  }
  async function removeAlert(id: number) {
    const { error } = await datos.from("sl_alerts").delete().eq("id", id);
    if (error) setError(error.message); else setAlerts(prev => prev.filter(a => a.id !== id));
  }

  const inputStyle: React.CSSProperties = {
    padding: "6px 10px", background: "var(--sr-surface)", border: "1px solid var(--sr-border)",
    borderRadius: "var(--sr-radius)", color: "var(--sr-text)", fontSize: "var(--sr-t-sm)", outline: "none", fontFamily: "inherit",
  };

  return (
    <div className="card" style={{ marginTop: "var(--sr-sp-5)" }}>
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>Alerts — {ticker}</div>
          <div className="sr-hint" style={{ maxWidth: 460, lineHeight: 1.5 }}>
            Get pinged on price, rating and valuation events. Enable browser push on the Macro tab to receive them in the background.
          </div>
        </div>
      </div>

      {/* Add alert */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-2)", alignItems: "center", marginTop: "var(--sr-sp-2)" }}>
        <select style={{ ...inputStyle, minWidth: 180 }} value={kind} onChange={e => setKind(e.target.value)}>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {needsThreshold && (
          <input style={{ ...inputStyle, width: 110 }} type="number" placeholder={price != null ? `$${price.toFixed(2)}` : "Price $"} value={threshold} onChange={e => setThreshold(e.target.value)} onKeyDown={e => e.key === "Enter" && addAlert()} />
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", cursor: "pointer" }} title="Auto-pause after it fires once (no daily re-fire)">
          <input type="checkbox" checked={oneShot} onChange={e => setOneShot(e.target.checked)} style={{ accentColor: "var(--sr-amber)" }} />
          one-shot
        </label>
        <button className="btn-primary" onClick={addAlert} style={{ padding: "6px 14px", fontSize: "var(--sr-t-sm)" }}>Add alert</button>
      </div>

      {error && <div style={{ marginTop: "var(--sr-sp-2)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{error}</div>}

      {/* Alert list */}
      <div style={{ marginTop: "var(--sr-sp-3)" }}>
        {loading ? <Sk w="100%" h={60} /> : alerts.length === 0 ? (
          <div className="sr-hint" style={{ padding: "var(--sr-sp-2) 0" }}>No alerts set for {ticker} yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-2)" }}>
            {alerts.map(a => {
              const live = a.active && isTriggeredNow(a, price, ratingLabel, rdcfUpside, tech);
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: `1px solid ${live ? "color-mix(in srgb, var(--sr-pos) 45%, transparent)" : "var(--sr-border)"}`, opacity: a.active ? 1 : 0.55 }}>
                  <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text)", flex: 1 }}>
                    {KIND_LABEL[a.kind] ?? a.kind}{a.threshold != null ? ` $${Number(a.threshold).toFixed(2)}` : ""}
                    {a.one_shot && <span style={{ marginLeft: 6, fontSize: "9px", fontWeight: 700, color: "var(--sr-text-3)", padding: "1px 6px", borderRadius: "var(--sr-radius-pill)", border: "1px solid var(--sr-border)" }}>one-shot</span>}
                  </span>
                  {live && <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--sr-pos)", padding: "1px 8px", borderRadius: "var(--sr-radius-pill)", background: "color-mix(in srgb, var(--sr-pos) 14%, transparent)" }}>🔔 TRIGGERED</span>}
                  {a.last_triggered_at && !live && <span className="sr-hint">last fired {new Date(a.last_triggered_at).toLocaleDateString()}</span>}
                  <button onClick={() => toggleActive(a)} title={a.active ? "Pause" : "Resume"} style={{ background: "none", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)", color: "var(--sr-text-3)", cursor: "pointer", padding: "2px 8px", fontSize: "var(--sr-t-xs)" }}>{a.active ? "Pause" : "Resume"}</button>
                  <button onClick={() => removeAlert(a.id)} title="Delete" style={{ background: "none", border: "none", color: "var(--sr-text-3)", cursor: "pointer", padding: "2px 6px", fontSize: "var(--sr-t-base)" }}>×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
