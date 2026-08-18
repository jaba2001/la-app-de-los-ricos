// Return attribution — "why did it move?"
//
// Decomposes a realized return into what the MARKET did, what the SECTOR did beyond
// the market, and what is left over (idiosyncratic — the part that is actually the
// company). Pure math over price series: no network, no AI, no estimates.
//
// This is deliberately a decomposition of the PAST, not a prediction. There is nothing
// to defend three months from now: the numbers either reproduce the realized return or
// they don't, and the idiosyncratic bucket is a residual that closes the identity by
// construction.
//
// Model (two orthogonal factors, estimated by OLS over a trailing window):
//   r_stock = β_m·r_market + β_s·(r_sector − β_sm·r_market) + ε
// The sector leg is orthogonalized against the market first, so the two systematic
// buckets never double-count the same move.

// NOTE: explicit .ts extension — this is the first value (non-type) import between two
// libs, and the golden-test runner (`node --experimental-strip-types`) resolves specifiers
// literally. tsconfig has `allowImportingTsExtensions`, so tsc and the bundler accept it.
// Sharing the estimator matters: a second copy of OLS beta would silently drift from the
// one the risk scorecard uses.
import { beta as olsBeta } from "./riskMetrics.ts";

/** One price observation. `date` is the ISO day (YYYY-MM-DD) used to align series. */
export interface DatedClose { date: string; close: number }

export interface AttributionInput {
  /** Stock closes, newest first. */
  stock: DatedClose[];
  /** Benchmark closes (SPY), newest first. */
  market: DatedClose[];
  /** Sector ETF closes, newest first. Pass null when the sector ETF *is* the benchmark
   *  (unknown sector falls back to SPY) — otherwise the sector leg would be a duplicate
   *  of the market leg and beta would be degenerate. */
  sector?: DatedClose[] | null;
  /** Trading days to attribute: 1 = today, 5 ≈ a week, 21 ≈ a month. */
  horizonDays: number;
  /** Trailing sample used to estimate the betas. Default 120 (~6 months). */
  betaWindow?: number;
}

export type AttributionKey = "market" | "sector" | "idio";

export interface AttributionComponent {
  key: AttributionKey;
  label: string;
  /** Percentage points of the total return explained by this bucket. */
  contribution: number;
  /** |contribution| ÷ Σ|contributions|, in [0,1]. Magnitude share, sign-agnostic —
   *  buckets can offset each other, so this answers "how much of the *movement*". */
  share: number;
}

export interface AttributionResult {
  horizonDays: number;
  /** Realized simple return over the horizon, in %. */
  totalReturn: number;
  marketReturn: number;
  /** Sector return net of its own market exposure, in %. Null when no sector leg. */
  sectorExcessReturn: number | null;
  betaMarket: number;
  betaSector: number | null;
  /** market + sector, in percentage points. */
  systematicReturn: number;
  /** The residual: total − systematic, in percentage points. */
  idioReturn: number;
  components: AttributionComponent[];
  /** Trading days actually used to estimate the betas. */
  sampleDays: number;
}

/** Betas outside this band are estimation artifacts (thin samples, stale prices),
 *  not real exposures. Clamping keeps a bad estimate from swallowing the residual. */
const BETA_CLAMP = 3;
/** Below this many overlapping observations an OLS beta is noise, not a measurement. */
const MIN_SAMPLE = 40;
const DEFAULT_WINDOW = 120;

const clampBeta = (b: number): number =>
  !Number.isFinite(b) ? 0 : Math.max(-BETA_CLAMP, Math.min(BETA_CLAMP, b));

/** Coerce a raw FMP/EOD row array into dated closes, dropping anything unusable
 *  (missing date, non-positive or non-finite close) and de-duplicating by day.
 *
 *  The result is sorted newest-first *by date* rather than trusting the provider's
 *  ordering: every horizon and sign in this module keys off index 0 being the most
 *  recent bar, so an upstream feed that flipped to oldest-first would otherwise
 *  invert every attribution silently. Sorting here makes that unrepresentable. */
export function toDatedCloses(rows: Record<string, unknown>[] | null | undefined): DatedClose[] {
  if (!Array.isArray(rows)) return [];
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (!r) continue;
    const rawDate = r.date;
    const date = typeof rawDate === "string" ? rawDate.slice(0, 10) : null;
    const close = Number(r.close);
    if (!date || !Number.isFinite(close) || close <= 0) continue;
    if (!byDate.has(date)) byDate.set(date, close);
  }
  return [...byDate.entries()]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Simple daily returns from closes ordered newest first. Result is also newest first
 *  and one element shorter: ret[i] is the move from close[i+1] to close[i]. */
function dailyReturns(series: DatedClose[]): { date: string; ret: number }[] {
  const out: { date: string; ret: number }[] = [];
  for (let i = 0; i < series.length - 1; i++) {
    const prev = series[i + 1].close;
    if (prev <= 0) continue;
    const ret = series[i].close / prev - 1;
    if (Number.isFinite(ret)) out.push({ date: series[i].date, ret });
  }
  return out;
}

/** Intersect return series on their dates, preserving newest-first order. Aligning on
 *  the date (not the index) is what keeps a mismatched holiday or a missing bar from
 *  silently shifting one series against the other. */
function alignReturns(series: { date: string; ret: number }[][]): number[][] {
  if (series.length === 0) return [];
  const maps = series.map((s) => new Map(s.map((p) => [p.date, p.ret])));
  const out: number[][] = series.map(() => []);
  for (const { date } of series[0]) {
    const vals: number[] = [];
    for (const m of maps) {
      const v = m.get(date);
      if (v === undefined) break;
      vals.push(v);
    }
    if (vals.length !== maps.length) continue;
    for (let i = 0; i < vals.length; i++) out[i].push(vals[i]);
  }
  return out;
}

/** Compounded simple return over `days` trading bars, in %, from newest-first closes. */
function horizonReturn(series: DatedClose[], days: number): number | null {
  if (series.length <= days) return null;
  const now = series[0].close, then = series[days].close;
  if (!(then > 0) || !Number.isFinite(now)) return null;
  return (now / then - 1) * 100;
}

/**
 * Attribute a realized return to market, sector and idiosyncratic buckets.
 *
 * Returns null when the inputs cannot support an honest answer (not enough overlapping
 * history, unusable prices, nonsensical horizon) — a wrong decomposition is worse than
 * no decomposition.
 */
export function attributeReturn(inp: AttributionInput): AttributionResult | null {
  const horizonDays = Math.floor(inp.horizonDays);
  if (!Number.isFinite(horizonDays) || horizonDays < 1) return null;

  const stock = inp.stock ?? [];
  const market = inp.market ?? [];
  if (stock.length <= horizonDays || market.length <= horizonDays) return null;

  // A sector leg identical to the benchmark carries no independent information.
  const sector = inp.sector && inp.sector.length > horizonDays ? inp.sector : null;

  const totalReturn = horizonReturn(stock, horizonDays);
  const marketReturn = horizonReturn(market, horizonDays);
  if (totalReturn === null || marketReturn === null) return null;

  const window = Math.max(MIN_SAMPLE, Math.floor(inp.betaWindow ?? DEFAULT_WINDOW));
  const sr = dailyReturns(stock);
  const mr = dailyReturns(market);
  const kr = sector ? dailyReturns(sector) : null;

  const aligned = alignReturns(kr ? [sr, mr, kr] : [sr, mr]);
  if (aligned.length === 0 || aligned[0].length < MIN_SAMPLE) return null;

  const stockRets = aligned[0].slice(0, window);
  const marketRets = aligned[1].slice(0, window);
  const sectorRets = kr ? aligned[2].slice(0, window) : null;
  const sampleDays = stockRets.length;

  const betaMarket = clampBeta(olsBeta(stockRets, marketRets));
  const marketContribution = betaMarket * marketReturn;

  let betaSector: number | null = null;
  let sectorExcessReturn: number | null = null;
  let sectorContribution = 0;

  if (sectorRets) {
    const sectorHorizon = horizonReturn(sector as DatedClose[], horizonDays);
    if (sectorHorizon !== null) {
      // Strip the sector's own market exposure so the two legs stay orthogonal.
      const betaSectorMarket = clampBeta(olsBeta(sectorRets, marketRets));
      const sectorExcessRets = sectorRets.map((r, i) => r - betaSectorMarket * marketRets[i]);
      const stockResidRets = stockRets.map((r, i) => r - betaMarket * marketRets[i]);
      betaSector = clampBeta(olsBeta(stockResidRets, sectorExcessRets));
      sectorExcessReturn = sectorHorizon - betaSectorMarket * marketReturn;
      sectorContribution = betaSector * sectorExcessReturn;
    }
  }

  // The residual closes the identity exactly: buckets always sum to the realized return.
  const systematicReturn = marketContribution + sectorContribution;
  const idioReturn = totalReturn - systematicReturn;

  const raw: { key: AttributionKey; label: string; contribution: number }[] = [
    { key: "market", label: "Market", contribution: marketContribution },
  ];
  if (betaSector !== null) raw.push({ key: "sector", label: "Sector", contribution: sectorContribution });
  raw.push({ key: "idio", label: "Company", contribution: idioReturn });

  const magnitude = raw.reduce((a, c) => a + Math.abs(c.contribution), 0);
  const components: AttributionComponent[] = raw.map((c) => ({
    ...c,
    share: magnitude > 0 ? Math.abs(c.contribution) / magnitude : 0,
  }));

  return {
    horizonDays,
    totalReturn,
    marketReturn,
    sectorExcessReturn,
    betaMarket,
    betaSector,
    systematicReturn,
    idioReturn,
    components,
    sampleDays,
  };
}

/** Which bucket drove the move. Null when the move is too small to be worth a claim —
 *  attributing a 0.05% day is numerology. */
export function dominantDriver(r: AttributionResult, minMove = 0.15): AttributionComponent | null {
  if (Math.abs(r.totalReturn) < minMove) return null;
  let best: AttributionComponent | null = null;
  for (const c of r.components) {
    if (!best || Math.abs(c.contribution) > Math.abs(best.contribution)) best = c;
  }
  return best;
}
