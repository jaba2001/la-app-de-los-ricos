"use client";
import type { MacroState } from "@/lib/types";
import { arbitrageCapitalStress, STRUCTURAL_EDGES } from "@/lib/frictions";
import { t, tv } from "@/lib/i18n/cliente";
import Trans from "@/components/Trans";

interface Props { macro: MacroState | null; }

const BAND_COLOR: Record<string, string> = {
  calmado: "var(--sr-pos)",
  normal: "var(--sr-text-2)",
  tenso: "var(--sr-warn)",
  crisis: "var(--sr-neg)",
};

/**
 * Estrés del capital de arbitraje (Shleifer & Vishny, 1997) + la ventaja estructural del
 * minorista, que es el mismo paper leído del revés.
 *
 * Todo sale de campos que `macro_state` YA trae de FRED/CBOE: sin datos nuevos, sin coste.
 * Es contexto descriptivo, no una señal de entrada — y el texto lo dice.
 */
/** Nombre en pantalla de cada banda (la clave interna sigue en español: salía «Calmado»). */
const BAND_LABEL: Record<string, string> = { calmado: "Calm", normal: "Normal", tenso: "Strained", crisis: "Crisis" };

export default function ArbitrageStress({ macro }: Props) {
  const stress = arbitrageCapitalStress({
    hyOasBps: macro?.hy_oas ?? null,
    nfci: macro?.nfci ?? null,
    stlfsi4: macro?.stlfsi4 ?? null,
    moveIndex: macro?.move_index ?? null,
    vix: macro?.vix ?? null,
  });

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
      <div className="section-label">{t("Arbitrage capital stress · Shleifer & Vishny (1997)")}</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55 }}>
        <Trans text={"Real arbitrage is done by a few specialists using <s1>other people’s</s1> money. When a trade moves against them, their investors withdraw capital exactly when the opportunity is best — so arbitrage capital is pro-cyclical and scarcest when it is most needed. This gauge tracks that pressure."} s1={(c) => <em>{c}</em>} /></div>

      {!stress ? (
        <div className="sr-hint">{t("Macro data not loaded yet.")}</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-3)" }}>
            <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: BAND_COLOR[stress.band] }}>
              {stress.score.toFixed(0)}<span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}>/100</span>
            </div>
            <div style={{ fontWeight: 700, color: BAND_COLOR[stress.band] }}>{t(BAND_LABEL[stress.band] ?? stress.band)}</div>
            <div className="sr-hint">{t(`${stress.covered} of 5 inputs available`)}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
            {stress.drivers.map((d) => (
              <div key={d.key} style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
                <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{tv(d.label)}</div>
                <div className="num" style={{ fontSize: "var(--sr-t-base)", fontWeight: 800 }}>{d.raw.toFixed(d.key === "hyOasBps" || d.key === "moveIndex" ? 0 : 2)}</div>
                <div className="num" style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>{t(`stress ${d.score.toFixed(0)}`)}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${BAND_COLOR[stress.band]} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${BAND_COLOR[stress.band]} 22%, transparent)`, fontSize: "var(--sr-t-xs)", lineHeight: 1.6 }}>
            {tv(stress.reading)}
          </div>
        </>
      )}

      <div className="section-label" style={{ marginTop: "var(--sr-sp-4)" }}>{t("Your structural edge")}</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55 }}>
        {t("The same paper, read backwards. Every constraint that forces a professional to liquidate early is one a private investor simply does not have. This is a thesis, not a calculation — it doesn’t pretend to be a number.")}</div>
      <div style={{ display: "grid", gap: "var(--sr-sp-2)" }}>
        {STRUCTURAL_EDGES.map((e) => (
          <div key={e.title} style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
            <div style={{ fontWeight: 700, fontSize: "var(--sr-t-sm)", marginBottom: 2 }}>{tv(e.title)}</div>
            <div className="sr-hint" style={{ lineHeight: 1.55 }}>{tv(e.detail)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
