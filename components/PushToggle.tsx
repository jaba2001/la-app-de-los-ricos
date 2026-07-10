"use client";
import { useEffect, useState } from "react";
import { pushConfigured, pushSupported, isSubscribed, enablePush, disablePush } from "@/lib/push";

// Opt-in to browser push alerts for regime changes & breadth divergences (B6 delivery).
// Renders nothing unless push is both supported and configured (VAPID key present).
export default function PushToggle() {
  const [ready, setReady] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!pushConfigured() || !pushSupported()) return;
    isSubscribed().then((s) => { setOn(s); setReady(true); });
  }, []);

  if (!ready) return null;

  async function toggle() {
    setBusy(true); setMsg("");
    if (on) { await disablePush(); setOn(false); }
    else { const r = await enablePush(); if (r.ok) setOn(true); else setMsg(r.error || "Failed"); }
    setBusy(false);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)", flexWrap: "wrap" }}>
      <button onClick={toggle} disabled={busy} style={{
        display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--sr-t-xs)", fontWeight: 600, cursor: "pointer",
        padding: "5px 12px", borderRadius: "var(--sr-radius-pill)",
        background: on ? "color-mix(in srgb, var(--sr-pos) 12%, transparent)" : "var(--sr-surface-2)",
        border: `1px solid ${on ? "color-mix(in srgb, var(--sr-pos) 35%, transparent)" : "var(--sr-border)"}`,
        color: on ? "var(--sr-pos)" : "var(--sr-text-2)",
      }}>
        {on ? "🔔 Regime alerts on" : "🔕 Enable regime alerts"}
      </button>
      {msg && <span style={{ fontSize: "10px", color: "var(--sr-neg)" }}>{msg}</span>}
      {!msg && <span className="sr-hint">Get notified on breadth divergences &amp; risk-off shifts.</span>}
    </div>
  );
}
