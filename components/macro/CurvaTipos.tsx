"use client";
import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/proxy";
import {
  forma, descomponer, credito, liston, avisoConTasaBase, UMBRALES_TIPOS,
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
  normal: "prestar más tiempo paga más, que es lo que cabe esperar",
  plana: "el plazo casi no se paga: el mercado no ve mucha diferencia entre dos años y diez",
  jorobada: "el tramo medio paga más que los dos extremos — la forma que aparece en los giros",
  invertida: "prestar a diez años paga MENOS que a dos, que sólo tiene sentido si se esperan bajadas de tipos",
};

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
      setInf5a5(ultimo(t5));
      setSerieBaa(baa);
      if (!ultimo(a10)) setError("FRED no ha devuelto el tramo de 10 años.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fallo al leer la curva de tipos");
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
    ["3 meses", curva.m3, "el dinero a la vista"],
    ["2 años", curva.a2, "lo que el mercado espera de la política monetaria"],
    ["10 años", curva.a10, "la referencia: el listón de todo lo demás"],
    ["30 años", curva.a30, "expectativas a muy largo plazo"],
  ] : [];

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
      <div className="section-label">La curva de tipos · el suelo que todo lo demás tiene que batir</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.55, maxWidth: 660 }}>
        Un bono del Tesoro es lo más parecido que hay a rentabilidad sin riesgo de impago. Si paga el 5 %, cualquier
        activo con riesgo tiene que batir ese 5 % para compensar. Por eso cuando los tipos suben,{" "}
        <strong>todo lo demás se reprecia a la baja</strong> — es la explicación de esos días en que la cartera cae sin
        ninguna noticia mala.
      </div>

      {error && (
        <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-warn) 10%, transparent)", color: "var(--sr-warn)", fontSize: "var(--sr-t-xs)" }}>{error}</div>
      )}
      {loading && !curva && <div className="sr-hint">Leyendo FRED…</div>}

      {curva && f && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-3)" }}>
            <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: TONO[f.forma] }}>
              {curva.a10 != null ? `${curva.a10.toFixed(2)} %` : "—"}
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}> a 10 años</span>
            </div>
            <div style={{ fontWeight: 700, textTransform: "capitalize", color: TONO[f.forma] }}>curva {f.forma}</div>
            <div className="sr-hint">
              10a−2a {f.t10y2 != null ? `${f.t10y2 >= 0 ? "+" : ""}${f.t10y2.toFixed(2)}` : "—"} ·
              {" "}10a−3m {f.t10y3m != null ? `${f.t10y3m >= 0 ? "+" : ""}${f.t10y3m.toFixed(2)}` : "—"}
            </div>
          </div>
          <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)" }}>{EXPLICA[f.forma]}.</div>

          <div style={{ overflowX: "auto" }}>
            <table className="sr-table">
              <thead><tr>
                <th>Plazo</th>
                <th style={{ textAlign: "right" }}>Rendimiento</th>
                <th>Qué mide</th>
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
              <div className="section-label">Nominal = real + inflación esperada</div>
              <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-2)", lineHeight: 1.55, maxWidth: 660 }}>
                Dos épocas con el mismo 4 % nominal no se parecen en nada: con inflación esperada al 1 % aprieta mucho
                más que con el 3 %. El <strong>tipo real</strong> sale de los TIPS; el breakeven es la diferencia.
              </div>
              <div style={{ display: "flex", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
                <div className="sr-tile"><div className="sr-tile-label">Nominal 10a</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{desc.nominal.toFixed(2)} %</div></div>
                <div className="sr-tile"><div className="sr-tile-label">Real 10a (TIPS)</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{desc.real.toFixed(2)} %</div></div>
                <div className="sr-tile"><div className="sr-tile-label">Breakeven</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{desc.breakeven.toFixed(2)} %</div><div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>implícito en los dos anteriores</div></div>
                <div className="sr-tile"><div className="sr-tile-label">5a dentro de 5a</div><div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{desc.expectativa5a5 == null ? "—" : `${desc.expectativa5a5.toFixed(2)} %`}</div><div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>otro horizonte: no se promedia</div></div>
              </div>
            </div>
          )}

          {cr && (
            <div style={{ marginTop: "var(--sr-sp-4)" }}>
              <div className="section-label">El diferencial de crédito · lo que cobra el mercado por prestar a quien puede fallar</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", flexWrap: "wrap", marginBottom: "var(--sr-sp-2)" }}>
                <div className="num" style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800 }}>{cr.valor.toFixed(2)}<span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", fontWeight: 600 }}> pp</span></div>
                {cr.percentil != null && (
                  <div style={{ fontWeight: 700, color: cr.percentil > 80 ? "var(--sr-neg)" : cr.percentil < 25 ? "var(--sr-pos)" : "var(--sr-text-2)" }}>
                    percentil {cr.percentil.toFixed(0)} de {serieBaa!.length.toLocaleString("es")} observaciones desde {serieBaa![0].date.slice(0, 4)}
                  </div>
                )}
                <div className="sr-hint">
                  hace 90 días {cr.hace90d == null ? "—" : `${cr.hace90d.toFixed(2)} pp`} ·
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
                Corte declarado: {UMBRALES_TIPOS.ensancheMinimo} pp en {UMBRALES_TIPOS.ventanaEnsanche} días.
                Se usa BAA10Y (Baa − Tesoro 10a) y no la serie de alto rendimiento de ICE BofA porque FRED
                sólo sirve 786 observaciones de ésta desde 2023: mide lo mismo con 41 años en vez de tres.
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
