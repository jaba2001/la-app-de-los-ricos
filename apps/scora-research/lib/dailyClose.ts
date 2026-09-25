// Tipos y lectura server-side del informe de cierre.
//
// El payload lo produce `lib/server/dailyClose.js` (plantilla determinista, sin LLM) y
// lo guarda el cron en `sl_daily_close`. Aquí solo se LEE — la interfaz de abajo es el
// contrato entre servidor y cliente, y hay un test en `scripts/dailyclose.test.mjs`
// que lo fija desde el otro lado para que un cambio en el backend no rompa esta página en
// silencio.
//
// La lectura va por REST con la anon key (pública) apoyándose en la política
// `sl_daily_close_read`. Se hace desde el SERVIDOR a propósito: el informe es la pieza
// indexable del producto, y un render de cliente le da a un buscador una página vacía.

export interface DailySectorRow { etf: string; name: string; changePct: number }

export interface DailyBreadth {
  up: number; down: number; total: number;
  dispersion: number; agreement: number;
  kind: "beta" | "rotation" | "broad" | "mixed";
}

export interface DailyReport {
  date: string;
  generatedAt: string;
  regime: { id: string | null; previousId: string | null; changed: boolean; confirmed: boolean };
  market: { spyChangePct: number | null; vix: number | null; hyOas: number | null; dgs10: number | null; riskOn: number | null };
  breadth: DailyBreadth | null;
  sectors: DailySectorRow[];
  leaders: DailySectorRow[];
  laggards: DailySectorRow[];
  headline: string;
  context: string;
  gaps: string[];
}

/** Cuánto puede tardar la página en reflejar un cierre nuevo. El cron escribe una vez al
 *  día, así que 15 minutos es de sobra y evita machacar la base en un pico de tráfico. */
const REVALIDATE_SECONDS = 900;

function restUrl(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/rest/v1/${path}`;
}

async function restGet<T>(path: string): Promise<T | null> {
  const url = restUrl(path);
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null; // la página degrada a su estado vacío; nunca revienta el render
  }
}

/** Un ISO day y nada más — va directo a una query, así que no se acepta nada raro. */
export function isIsoDay(s: string | null | undefined): boolean {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** El informe de un día concreto, o el más reciente si no se pasa fecha. */
export async function fetchDailyClose(date?: string): Promise<DailyReport | null> {
  const filter = date
    ? `sl_daily_close?close_date=eq.${encodeURIComponent(date)}&select=payload&limit=1`
    : `sl_daily_close?select=payload&order=close_date.desc&limit=1`;
  const rows = await restGet<{ payload: DailyReport }[]>(filter);
  return Array.isArray(rows) && rows[0]?.payload ? rows[0].payload : null;
}

/** Fechas publicadas, de la más reciente a la más antigua. Alimenta el navegador de días
 *  y el sitemap. */
export async function fetchDailyDates(limit = 30): Promise<string[]> {
  const rows = await restGet<{ close_date: string }[]>(
    `sl_daily_close?select=close_date&order=close_date.desc&limit=${Math.max(1, Math.min(365, limit))}`
  );
  return Array.isArray(rows) ? rows.map((r) => r.close_date).filter(isIsoDay) : [];
}

// ── Presentación compartida (server-safe: sin estado, sin hooks) ────────────────

export const BREADTH_LABEL: Record<DailyBreadth["kind"], string> = {
  beta: "One-factor day",
  rotation: "Rotation",
  broad: "Broad move",
  mixed: "Split",
};

export const BREADTH_NOTE: Record<DailyBreadth["kind"], string> = {
  beta: "Sectors moved together — stock selection had little to work with.",
  rotation: "Money moved between sectors rather than in or out of the market.",
  broad: "Most sectors on the same side, with real spread between them.",
  mixed: "No clean read — the tape disagreed with itself.",
};

export const signedPct = (v: number, dp = 2): string =>
  `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}%`;

/** Frase corta para <title>, meta description y la tarjeta social. Es lo que se ve en un
 *  resultado de búsqueda o al compartir, así que lleva la cifra, no un adjetivo. */
export function dailySummaryLine(rep: DailyReport): string {
  const bits: string[] = [];
  if (rep.market.spyChangePct != null) bits.push(`S&P 500 ${signedPct(rep.market.spyChangePct)}`);
  if (rep.breadth) bits.push(`${BREADTH_LABEL[rep.breadth.kind].toLowerCase()} · ${rep.breadth.up}/${rep.breadth.total} sectors up`);
  if (rep.regime.changed && rep.regime.id) bits.push(`regime → ${rep.regime.id}`);
  else if (rep.regime.id) bits.push(`regime ${rep.regime.id}`);
  return bits.join(" · ") || "Measured market close.";
}

/** Formato largo y estable de la fecha, sin depender del locale del servidor. */
export function formatDayLong(iso: string): string {
  if (!isIsoDay(iso)) return iso;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}
