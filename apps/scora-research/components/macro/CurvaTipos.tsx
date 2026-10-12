"use client";
import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/proxy";
import {
  forma, descomponer, credito, liston, avisoConTasaBase, lecturaTipoReal, UMBRALES_TIPOS,
  type Curva, type FormaCurva,
} from "@/lib/tipos";

type Obs = { date: string; value: string };

const TONO: Record<FormaCurva, string> = {
  normal: "var(--sr-pos)",
  plana: "var(--sr-text-2)",
  jorobada: "var(--sr-warn)",
  invertida: "var(--sr-neg)",
};

const EXPLICA: Record<FormaCurva, string> = {
  normal: "lending for longer pays more, which is what you would expect",
  plana: "term barely gets paid: the market sees little difference between two years and ten",
  jorobada: "the middle of the curve pays more than both ends — the shape that shows up at turning points",
  invertida: "lending for ten years pays LESS than for two, which only makes sense if rate cuts are expected",
};

/** Nombre en pantalla de cada forma (la clave interna sigue en español). */
const NOMBRE_FORMA: Record<FormaCurva, string> = { normal: "normal", plana: "flat", jorobada: "humped", invertida: "inverted" };

/**
 * LA CURVA DE TIPOS, Y EL LISTÓN QUE PONE.
 *
 * La idea que ningún panel para minoristas enseña y que ordena todo lo demás: **el tipo sin
 * riesgo es el suelo que cualquier activo con riesgo tiene que batir.** Cuando sube, todo lo
 * demás se reprecia a la baja — y por eso una cartera puede caer un día sin ninguna noticia mala.
 *
 * No decide nada. No entra en el score ni mueve un peso: es capa explicativa, y por eso su
 * riesgo de sobreajuste es exactamente cero. La aritmética vive en `lib/tipos.ts`, que está
 * cubierta por `scripts/tipos.test.mjs`; aquí sólo se pinta.
 */
export default function CurvaTipos() {
  const [curva, setCurva] = useState<Curva | null>(null);
  const [real10, setReal10] = useState<number | null>(null);
  const [deltaReal, setDeltaReal] = useState<number | null>(null);
  const [inf5a5, setInf5a5] = useState<number | null>(null);
  const [serieBaa, setSerieBaa] = useState<{ date: string; v: number }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const desdeCorto = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
      const traer = async (id: string, desde: string) => {
        const r = await authedFetch<{ observations?: Obs[] }>(
          `/api/fred/series?series_id=${id}&frequency=d&observation_start=${desde}`);
        return (r?.observations ?? [])
          .map((o) => ({ date: o.date, v: Number(o.value) }))
          .filter((o) => Number.isFinite(o.v));   // FRED marca los huecos con "."
      };
      const ultimo = (a: { v: number }[]) => (a.length ? a[a.length - 1].v : null);

      // ⚠️ BAA10Y SE PIDE DESDE 1986 Y EN DIARIO A PROPÓSITO, aunque sean ~10.000 puntos. El
      // percentil que se publica aquí tiene que ser EL MISMO que el de `research/tipos.mjs`;
      // pedirlo mensual daría un número parecido y distinto, y una cifra que no coincide con
      // la del artefacto es justo la deriva que este proyecto persigue.
      const [m3, a2, a10, a30, dfii, t5, baa] = await Promise.all([
        traer("DGS3MO", desdeCorto), traer("DGS2", desdeCorto),
        traer("DGS10", desdeCorto), traer("DGS30", desdeCorto),
        traer("DFII10", desdeCorto), traer("T5YIFR", desdeCorto),
        traer("BAA10Y", "1986-01-01"),
      ]);
      setCurva({ m3: ultimo(m3), a2: ultimo(a2), a10: ultimo(a10), a30: ultimo(a30) });
      setReal10(ultimo(dfii));
      // El cambio del tipo real en ~30 dias, para la lectura de sensibilidad de los metales.
      const corte = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const antes = dfii.filter((o) => o.date <= corte);
      const hoyReal = ultimo(dfii);
      setDeltaReal(antes.length && hoyReal != null ? hoyReal - antes[antes.length - 1].v : null);
      setInf5a5(ultimo(t5));
      setSerieBaa(baa);
      if (!ultimo(a10)) setError("FRED didn't return the 10-year yield.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the yield curve");
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (!curva && !loading && !error) void run(); }, [curva, loading, error, run]);

  const f = curva ? forma(curva) : null;
  const desc = curva ? descomponer(curva.a10, real10, inf5a5) : null;
  const hoy = new Date().toISOString().slice(0, 10);
  const cr = serieBaa?.length ? credito(serieBaa, hoy) : null;
  const frase = curva ? liston(curva.a10, real10) : null;

  const tramos: [string, number | null, string][] = curva ? [
    ["3 months", curva.m3, "cash"],
    ["2 years", curva.a2, "what the market expects from monetary policy"],
    ["10 years", curva.a10, "the benchmark: the bar for everything else"],
    ["30 years", curva.a30, "very long-term expectations"],
  ] : [];

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
      <div className="section-label">The yield curve · the floor everything else has to beat</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55, maxWidth: 660 }}>
        A Treasury bond is the closest thing there is to a return with no default risk. If it pays 5%, any risky
        asset has to beat that 5% to be worth it. That is why, when rates rise,{" "}
        <strong>everything else reprices lower</strong> — the explanation for those days the portfolio falls with no
        bad news at all.
      </div>

      {error && (
        <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-warn) 10%, transparent)", color: "var(--sr-warn)", fontSize: "var(--sr-t-xs)" }}>{error}</div>
      )}
      {loading && !curva && <div className="sr-hint">Reading FRED…</div>}

      {curva && f && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-3)" }}>
            <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: TONO[f.forma] }}>
              {curva.a10 != null ? `${curva.a10.toFixed(2)} %` : "—"}
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}> 10-year</span>
            </div>
            <div style={{ fontWeight: 700, textTransform: "capitalize", color: TONO[f.forma] }}>{NOMBRE_FORMA[f.forma]} curve</div>
            <div className="sr-hint">
              10y−2y {f.t10y2 != null ? `${f.t10y2 >= 0 ? "+" : ""}${f.t10y2.toFixed(2)}` : "—"} ·
              {" "}10y−3m {f.t10y3m != null ? `${f.t10y3m >= 0 ? "+" : ""}${f.t10y3m.toFixed(2)}` : "—"}
            </div>
          </div>
          <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)" }}>{EXPLICA[f.forma]}.</div>

          <div style={{ overflowX: "auto" }}>
            <table className="sr-table">
              <thead><tr>
                <th>Maturity</th>
                <th style={{ textAlign: "right" }}>Yield</th>
                <th>What it measures</th>
              </tr></thead>
              <tbody>
                {tramos.map(([k, v, q]) => (
                  <tr key={k}>
                    <td style={{ fontWeight: 600 }}>{k}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }} className="num">{v == null ? "—" : `${v.toFixed(2)} %`}</td>
                    <td className="sr-hint">{q}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {desc && (
            <div style={{ marginTop: "var(--sr-sp-4)" }}>
              <div className="section-label">Nominal = real + expected inflation</div>
              <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-2)", lineHeight: 1.55, maxWidth: 660 }}>
                Two periods with the same 4% nominal yield look nothing alike: with expected inflation at 1% it bites much
                harder than at 3%. The <strong>real yield</strong> comes from TIPS; the breakeven is the difference.
              </div>
              <div style={{ display: "flex", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
                <div className="sr-tile"><div className="sr-tile-label">Nominal 10y</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{desc.nominal.toFixed(2)} %</div></div>
                <div className="sr-tile"><div className="sr-tile-label">Real 10y (TIPS)</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{desc.real.toFixed(2)} %</div></div>
                <div className="sr-tile"><div className="sr-tile-label">Breakeven</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{desc.breakeven.toFixed(2)} %</div><div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>implied by the two before</div></div>
                <div className="sr-tile"><div className="sr-tile-label">5y, 5y forward</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{desc.expectativa5a5 == null ? "—" : `${desc.expectativa5a5.toFixed(2)} %`}</div><div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>a different horizon: not averaged in</div></div>
              </div>
            </div>
          )}

          {cr && (
            <div style={{ marginTop: "var(--sr-sp-4)" }}>
              <div className="section-label">The credit spread · what the market charges to lend to someone who might default</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-2)" }}>
                <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800 }}>{cr.valor.toFixed(2)}<span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}> pp</span></div>
                {cr.percentil != null && (
                  <div style={{ fontWeight: 700, color: cr.percentil > 80 ? "var(--sr-neg)" : cr.percentil < 25 ? "var(--sr-pos)" : "var(--sr-text-2)" }}>
                    {cr.percentil.toFixed(0)}th percentile of {serieBaa!.length.toLocaleString("en")} observations since {serieBaa![0].date.slice(0, 4)}
                  </div>
                )}
                <div className="sr-hint">
                  90 days ago {cr.hace90d == null ? "—" : `${cr.hace90d.toFixed(2)} pp`} ·
                  {" "}delta {cr.delta == null ? "—" : `${cr.delta >= 0 ? "+" : ""}${cr.delta.toFixed(2)}`}
                </div>
              </div>
              {/* ⚠️ EL BOOLEANO NUNCA SALE SOLO. Medido sobre 22 episodios independientes en 33 años,
                  el aviso de ensanchamiento NO se distingue del azar (p = 0,146) y 8 de 22 fueron
                  seguidos de un año de más del +20 %. `avisoConTasaBase` obliga a publicar esa tasa
                  base junto al aviso, y `scripts/tipos.test.mjs` falla si alguien la quita. */}
              <div className="sr-hint" style={{ lineHeight: 1.6, maxWidth: 700, padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-text-3) 8%, transparent)" }}>
                {avisoConTasaBase(cr.ensanchando)}
              </div>
              <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>
                Declared cutoff: {UMBRALES_TIPOS.ensancheMinimo} pp in {UMBRALES_TIPOS.ventanaEnsanche} days.
                It uses BAA10Y (Baa − 10y Treasury) rather than the ICE BofA high-yield series because FRED
                only serves 786 observations of that one since 2023: it measures the same thing with 41 years instead of three.
              </div>
            </div>
          )}

          {/* ⚠️ EL NUMERO CONTEMPORANEO NUNCA SALE SOLO. La relacion tipo real → oro es real y
              enorme (+2,46 %/mes bajando contra -0,79 % subiendo) y es del MISMO mes: mirando al
              siguiente el |rho| medio cae de 0,312 a 0,098. `lecturaTipoReal` obliga a publicar
              las dos cifras juntas, y scripts/tipos.test.mjs falla si alguien quita la segunda. */}
          {real10 != null && (
            <div style={{ marginTop: "var(--sr-sp-4)" }}>
              <div className="section-label">The real yield and metals</div>
              <div className="sr-hint" style={{ lineHeight: 1.6, maxWidth: 700, padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-text-3) 8%, transparent)" }}>
                {lecturaTipoReal(deltaReal)}
              </div>
            </div>
          )}

          {frase && (
            <div className="sr-hint" style={{ marginTop: "var(--sr-sp-4)", lineHeight: 1.6, fontWeight: 600, color: "var(--sr-text-2)" }}>
              {frase}
            </div>
          )}
        </>
      )}
    </div>
  );
}
