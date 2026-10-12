"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n/cliente";
import Trans from "@/components/Trans";

// First-run welcome (B2). Dismissible, remembered in localStorage — no server round-trip.
// Points a new user at the one thing that matters: the regime read drives everything below.
const KEY = "scora_welcomed_v1";

export default function WelcomeBanner() {
  const [show, setShow] = useState(false);
  const router = useRouter();

  useEffect(() => { try { setShow(localStorage.getItem(KEY) !== "1"); } catch { /* SSR / privacy mode */ } }, []);
  if (!show) return null;

  const dismiss = () => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } setShow(false); };

  return (
    <div style={{ marginBottom: "var(--sr-sp-4)", padding: "var(--sr-sp-4)", borderRadius: "var(--sr-radius-lg, 14px)", background: "color-mix(in srgb, var(--sr-amber) 7%, var(--sr-surface-2))", border: "1px solid color-mix(in srgb, var(--sr-amber) 26%, transparent)" }}>
      <div className="sr-flex-between" style={{ alignItems: "flex-start", gap: "var(--sr-sp-3)" }}>
        <div>
          <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700 }}>{t("Welcome to Scora 👋")}</div>
          <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 4, maxWidth: 640, lineHeight: 1.55 }}>
            <Trans text={"Read it top-down: the <s1>regime</s1> here sets everything. In three steps —"} s1={(c) => <strong style={{ color: "var(--sr-text)" }}>{c}</strong>} /></div>
        </div>
        <button onClick={dismiss} aria-label={t("Dismiss")} style={{ background: "none", border: "none", color: "var(--sr-text-3)", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
      </div>
      <ol style={{ margin: "var(--sr-sp-3) 0 0", paddingLeft: 18, fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.7 }}>
        <li><Trans text={"Check the <s1>risk-on gauge</s1> & the top-down↔bottom-up loop in the Regime Radar (Portfolio tab)."} s1={(c) => <strong>{c}</strong>} /></li>
        <li>{t("Search any ticker up top — stocks, bonds, metals, ETFs all get the right analysis.")}</li>
        <li>{t("See the")}{" "}<a onClick={() => router.push("/track-record")} style={{ cursor: "pointer" }}>{t("evidence")}</a> {" "}{t("and the")}{" "}<a onClick={() => router.push("/audit")} style={{ cursor: "pointer" }}>{t("AI audit trail")}</a> {" "}{t("— everything is measured, not asserted.")}</li>
      </ol>
      <button onClick={dismiss} style={{ marginTop: "var(--sr-sp-3)", background: "var(--sr-amber)", color: "var(--sr-text-inv)", border: "none", borderRadius: "var(--sr-radius)", padding: "7px 18px", fontSize: "var(--sr-t-xs)", fontWeight: 700, cursor: "pointer" }}>{t("Got it")}</button>
    </div>
  );
}
