// Tarjeta social de un cierre concreto.
//
// Es lo que realmente se propaga: un enlace sin imagen en LinkedIn o X pasa desapercibido.
// Lleva las tres cifras del día —índice, tipo de día, régimen— porque el gancho honesto es
// el número, no el adjetivo.
//
// Sin fuentes externas ni imágenes remotas: `ImageResponse` corre en el edge y cualquier
// fetch a un host externo la haría fallar en silencio y devolver una tarjeta rota.

import { ImageResponse } from "next/og";
import { fetchDailyClose, isIsoDay, signedPct, BREADTH_LABEL } from "@/lib/dailyClose";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Scora Research — daily market close";

const BG = "#070E1A";
const AMBER = "#F5A524";
const TEXT = "#E8EDF5";
const MUTED = "#8A94A6";
const POS = "#2ECC71";
const NEG = "#FF5C5C";

export default async function Image({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const rep = isIsoDay(date) ? await fetchDailyClose(date) : null;

  const spy = rep?.market.spyChangePct ?? null;
  const spyColor = spy == null ? TEXT : spy >= 0 ? POS : NEG;
  const kind = rep?.breadth ? BREADTH_LABEL[rep.breadth.kind] : null;

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", background: BG, display: "flex", flexDirection: "column",
        justifyContent: "space-between", padding: 64, fontFamily: "sans-serif",
      }}>
        {/* Marca */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, background: AMBER,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, fontWeight: 800, color: BG,
          }}>S</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: TEXT, display: "flex" }}>
            Scora <span style={{ color: MUTED, marginLeft: 8, fontWeight: 400 }}>Research</span>
          </div>
        </div>

        {/* Las cifras */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 26, color: MUTED, display: "flex" }}>Daily close · {date}</div>
          {spy != null ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
              <div style={{ fontSize: 128, fontWeight: 800, color: spyColor, lineHeight: 1 }}>
                {signedPct(spy)}
              </div>
              <div style={{ fontSize: 34, color: MUTED }}>S&amp;P 500</div>
            </div>
          ) : (
            <div style={{ fontSize: 68, fontWeight: 800, color: TEXT, display: "flex" }}>Market close</div>
          )}
          {rep?.breadth && (
            <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 32, color: TEXT }}>
              <span style={{ color: AMBER, fontWeight: 700 }}>{kind}</span>
              <span style={{ color: MUTED }}>
                {rep.breadth.up}/{rep.breadth.total} sectors up · {rep.breadth.dispersion.toFixed(2)} pp dispersion
              </span>
            </div>
          )}
          {rep?.regime.changed && rep.regime.id && (
            <div style={{ fontSize: 30, color: AMBER, fontWeight: 700, display: "flex" }}>
              Regime change → {rep.regime.id}
            </div>
          )}
        </div>

        {/* La promesa, que es el diferencial */}
        <div style={{ fontSize: 24, color: MUTED, display: "flex" }}>
          Measured, not forecast · no model writes these numbers
        </div>
      </div>
    ),
    size
  );
}
