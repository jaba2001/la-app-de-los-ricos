"use client";
import type { MacroState } from "@/lib/types";
import { arbitrageCapitalStress, STRUCTURAL_EDGES } from "@/lib/frictions";

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
      <div className="section-label">Arbitrage capital stress · Shleifer &amp; Vishny (1997)</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55 }}>
        Real arbitrage is done by a few specialists using <em>other people&rsquo;s</em> money. When a trade moves
        against them, their investors withdraw capital exactly when the opportunity is best — so arbitrage capital
        is pro-cyclical and scarcest when it is most needed. This gauge tracks that pressure.
      </div>

      {!stress ? (
        <div className="sr-hint">Macro data not loaded yet.</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-3)" }}>
            <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: BAND_COLOR[stress.band] }}>
              {stress.score.toFixed(0)}<span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}>/100</span>
            </div>
            <div style={{ textTransform: "capitalize", fontWeight: 700, color: BAND_COLOR[stress.band] }}>{stress.band}</div>
            <div className="sr-hint">{stress.covered} of 5 inputs available</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
            {stress.drivers.map((d) => (
              <div key={d.key} style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
                <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{d.label}</div>
                <div className="num" style={{ fontSize: "var(--sr-t-base)", fontWeight: 800 }}>{d.raw.toFixed(d.key === "hyOasBps" || d.key === "moveIndex" ? 0 : 2)}</div>
                <div className="num" style={{ fontSize: "9px", color: "var(--sr-text-3)" }}>stress {d.score.toFixed(0)}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${BAND_COLOR[stress.band]} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${BAND_COLOR[stress.band]} 22%, transparent)`, fontSize: "var(--sr-t-xs)", lineHeight: 1.6 }}>
            {stress.reading}
          </div>
        </>
      )}

      <div className="section-label" style={{ marginTop: "var(--sr-sp-4)" }}>Your structural edge</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55 }}>
        The same paper, read backwards. Every constraint that forces a professional to liquidate early is one a
        private investor simply does not have. This is a thesis, not a calculation — it doesn&rsquo;t pretend to be a number.
      </div>
      <div style={{ display: "grid", gap: "var(--sr-sp-2)" }}>
        {STRUCTURAL_EDGES.map((e) => (
          <div key={e.title} style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
            <div style={{ fontWeight: 700, fontSize: "var(--sr-t-sm)", marginBottom: 2 }}>{e.title}</div>
            <div className="sr-hint" style={{ lineHeight: 1.55 }}>{e.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
