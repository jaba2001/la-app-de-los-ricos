// ─────────────────────────────────────────────────────────────────────────────
// Plomería compartida del modelo de factores: definición de los factores macro, remuestreo
// a mensual y descarga de las series de FRED.
//
// Existe para que `components/stock/RiskModel.tsx` (un nombre) y
// `components/journal/FactorExposure.tsx` (la cartera) usen EXACTAMENTE los mismos factores,
// las mismas transformaciones a innovaciones y el mismo remuestreo. Si esto viviera duplicado
// en los dos componentes, derivarían — y entonces la beta de un nombre y la de la cartera que
// lo contiene dejarían de ser comparables, que es justo la comparación que da valor.
// ─────────────────────────────────────────────────────────────────────────────
import { authedFetch } from "./proxy";
import { innovations, type InnovationMethod } from "./factorModel";

/**
 * Los factores de Chen, Roll & Ross (1986) con series gratuitas de FRED, más el mercado
 * (que es el factor del CAPM). El paper propuso producción industrial, inflación no
 * anticipada, cambio en la inflación esperada, prima de PLAZO y prima de CRÉDITO; aquí van
 * esas dos primas, la inflación esperada, el petróleo y el dólar.
 *
 * `method` marca cómo se convierte el NIVEL en SORPRESA. Es el punto metodológico que más
 * importa: un nivel no es un shock.
 */
export const MACRO_FACTORS: {
  id: string; label: string; series: string; method: InnovationMethod; shockUnit: string;
}[] = [
  { id: "term",   label: "Prima de plazo (10a−3m)", series: "T10Y3M",       method: "diff", shockUnit: "pp" },
  { id: "credit", label: "Spread de crédito HY",    series: "BAMLH0A0HYM2", method: "diff", shockUnit: "pp" },
  { id: "infl",   label: "Inflación esperada 10a",  series: "T10YIE",       method: "diff", shockUnit: "pp" },
  { id: "oil",    label: "Petróleo (WTI)",          series: "DCOILWTICO",   method: "pct",  shockUnit: "%" },
  { id: "usd",    label: "Dólar (índice amplio)",   series: "DTWEXBGS",     method: "pct",  shockUnit: "%" },
];

/** Etiquetas en lenguaje llano, para `explainLoadings`. */
export const FACTOR_LABELS: Record<string, string> = {
  market: "el mercado", term: "la pendiente de tipos", credit: "el riesgo de crédito",
  infl: "la inflación esperada", oil: "el petróleo", usd: "el dólar",
};

export interface DatedClose { date: string; close: number }

/** Normaliza el histórico de FMP (más reciente primero) a orden cronológico. */
export function fromHistory(rows: Record<string, unknown>[]): DatedClose[] {
  return rows
    .map((h) => ({ date: String(h.date ?? ""), close: Number(h.adjClose ?? h.close) }))
    .filter((r) => r.date && isFinite(r.close) && r.close > 0)
    .reverse();
}

/** Último cierre de cada mes, en orden cronológico. */
export function monthlyCloses(rows: DatedClose[]): DatedClose[] {
  const byMonth = new Map<string, DatedClose>();
  for (const r of rows) {
    if (!r.date || !isFinite(r.close) || r.close <= 0) continue;
    const key = r.date.slice(0, 7);
    const cur = byMonth.get(key);
    if (!cur || r.date > cur.date) byMonth.set(key, r);
  }
  return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
}

/** Retornos simples en % a partir de una serie de cierres cronológica. */
export function pctReturns(closes: { close: number }[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) out.push((closes[i].close / closes[i - 1].close - 1) * 100);
  return out;
}

/** Serie mensual de retornos (%) de un ticker, desde su histórico diario de FMP. */
export function monthlyReturnsFromHistory(rows: Record<string, unknown>[]): number[] {
  return pctReturns(monthlyCloses(fromHistory(rows)));
}

/**
 * Descarga las series macro de FRED (ya agregadas a mensual por FRED) y las convierte en
 * innovaciones. Un factor sin historial suficiente se OMITE en vez de entrar con huecos:
 * meter una serie corta arruinaría la alineación de toda la regresión.
 *
 * `minObs` es el mínimo de observaciones para admitir un factor.
 */
export async function fetchMacroInnovations(
  observationStart: string, minObs = 24
): Promise<{ factors: Record<string, number[]>; skipped: string[] }> {
  const results = await Promise.all(MACRO_FACTORS.map(async (f) => {
    try {
      const res = await authedFetch<{ observations?: { date: string; value: string }[] }>(
        `/api/fred/series?series_id=${f.series}&frequency=m&observation_start=${observationStart}`
      );
      // FRED marca los huecos con "." → Number(".") es NaN y se filtra.
      const vals = (res?.observations ?? []).map((o) => Number(o.value)).filter((v) => isFinite(v));
      return { f, vals };
    } catch {
      return { f, vals: [] as number[] };
    }
  }));

  const factors: Record<string, number[]> = {};
  const skipped: string[] = [];
  for (const { f, vals } of results) {
    if (vals.length < minObs) { skipped.push(f.label); continue; }
    factors[f.id] = innovations(vals, f.method);
  }
  return { factors, skipped };
}

/** Escenarios de shock, en las MISMAS unidades que las innovaciones que ajustan el modelo. */
export const SCENARIOS: { label: string; shocks: Record<string, number> }[] = [
  { label: "Crédito +150 pb", shocks: { credit: 1.5 } },
  { label: "Petróleo +30%", shocks: { oil: 30 } },
  { label: "Dólar +5%", shocks: { usd: 5 } },
  { label: "Mercado −10%", shocks: { market: -10 } },
  { label: "Curva +100 pb", shocks: { term: 1 } },
];
