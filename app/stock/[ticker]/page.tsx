"use client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/proxy";
import { calcScores, calcFactorTilts, calcSubScores, getRating, getMacroTilt, findDisqualifiers, SECTOR_ETF, SCORE_VERSION_SECTOR_PCTL, SCORE_VERSION_ABSOLUTE_BANDS, type FactorTilts, type SubScores, type Disqualifier } from "@/lib/scoring";
import { loadFactorDist, distForScoring, SCORE_USES_SECTOR_PERCENTILES } from "@/lib/factorDist";
import { trendStage, detectBaseBreakout, type OHLCV } from "@/lib/technicalIndicators";
import { normalizeFundamentals, finnhubToFinvizFallback, mergeFinviz } from "@/lib/normalize";
import { computeReverseDCF } from "@/lib/reverseDcf";
import { useMacroContext } from "@/lib/MacroContext";
import { track } from "@/lib/analytics";
import { useMode, setMode, tabVisible, BEGINNER_TABS } from "@/lib/mode";
import type { MacroState, Scores, StockAnalysis, ReverseDCFSnapshot, FinvizData } from "@/lib/types";
import dynamic from "next/dynamic";
import { Sk } from "@/components/ui/Skeleton";

const TabSk = () => <Sk w="100%" h={500} />;

const Verdict           = dynamic(() => import("@/components/stock/Verdict"),           { ssr: false });
const StockOverview     = dynamic(() => import("@/components/stock/StockOverview"),     { loading: TabSk, ssr: false });
const StockSignals      = dynamic(() => import("@/components/stock/StockSignals"),      { loading: TabSk, ssr: false });
const StockFundamentals = dynamic(() => import("@/components/stock/StockFundamentals"), { loading: TabSk, ssr: false });
// La capa de caja (fase 1): «lo que no es caja, no vale». Diagnostico, banderas rojas y el
// destino de la caja, con el mismo liston que el Sankey de resultados: si no cuadra, no se pinta.
const FlujoDeCaja       = dynamic(() => import("@/components/stock/FlujoDeCaja"),       { loading: TabSk, ssr: false });
const StockValuation    = dynamic(() => import("@/components/stock/StockValuation"),    { loading: TabSk, ssr: false });
const StockChart        = dynamic(() => import("@/components/stock/StockChart"),        { loading: TabSk, ssr: false });
const StockResearch     = dynamic(() => import("@/components/stock/StockResearch"),     { loading: TabSk, ssr: false });
const StockReport       = dynamic(() => import("@/components/stock/StockReport"),       { loading: TabSk, ssr: false });
const DueDiligence      = dynamic(() => import("@/components/stock/DueDiligence"),      { loading: TabSk, ssr: false });
const StockSmartMoney   = dynamic(() => import("@/components/stock/StockSmartMoney"),   { loading: TabSk, ssr: false });
const StockScreener     = dynamic(() => import("@/components/stock/StockScreener"),     { loading: TabSk, ssr: false });
const StockCompare      = dynamic(() => import("@/components/stock/StockCompare"),      { loading: TabSk, ssr: false });
const StockSentiment    = dynamic(() => import("@/components/stock/StockSentiment"),    { loading: TabSk, ssr: false });
const StockNews         = dynamic(() => import("@/components/stock/StockNews"),         { loading: TabSk, ssr: false });
const AlertConfig       = dynamic(() => import("@/components/stock/AlertConfig"),       { ssr: false });
const OptionsCalc       = dynamic(() => import("@/components/stock/OptionsCalc"),       { loading: TabSk, ssr: false });
const OptionsLab        = dynamic(() => import("@/components/stock/OptionsLab"),        { loading: TabSk, ssr: false });
const RiskModel         = dynamic(() => import("@/components/stock/RiskModel"),         { loading: TabSk, ssr: false });
const Governance        = dynamic(() => import("@/components/stock/Governance"),        { loading: TabSk, ssr: false });
const RevenueForecast   = dynamic(() => import("@/components/stock/RevenueForecast"),   { ssr: false });
const ValuationLab      = dynamic(() => import("@/components/stock/ValuationLab"),      { ssr: false });

const TABS = [
  { id: "overview",      label: "Overview" },
  { id: "signals",       label: "Signals" },
  { id: "riskmodel",     label: "Risk Model" },
  { id: "governance",    label: "Governance" },
  { id: "fundamentals",  label: "Fundamentals" },
  { id: "valuation",     label: "Valuation" },
  { id: "report",        label: "Report" },
  { id: "diligence",     label: "Diligence" },
  { id: "chart",         label: "Chart" },
  { id: "research",      label: "Research" },
  { id: "smartmoney",    label: "Smart Money" },
  { id: "sentiment",     label: "Sentiment" },
  { id: "news",          label: "News" },
  { id: "options",       label: "Options" },
  { id: "screener",      label: "Screener" },
  { id: "compare",       label: "Compare" },
];

export interface StockData {
  quote: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  ratios: Record<string, unknown> | null;
  history: Record<string, unknown>[];
  income: Record<string, unknown>[];
  balanceSheet: Record<string, unknown>[];
  cashFlow: Record<string, unknown>[];
  peers: string[];
  priceTargets: Record<string, unknown>[];
  analystEstimates: Record<string, unknown>[];
  institutionalHolders: Record<string, unknown>[];
  earningsSurprises: Record<string, unknown>[];
  insiderTrades: Record<string, unknown>[];
  dcf: Record<string, unknown> | null;
  spyHistory: Record<string, unknown>[];
  sectorEtfHistory: Record<string, unknown>[];
  sectorEtfSymbol: string;
  congressTrades: Record<string, unknown>[];
  houseDisclosures: Record<string, unknown>[];
  annualIncome: Record<string, unknown>[];
  sharesFloat: Record<string, unknown>[];
  analystConsensus: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; period: string } | null;
  rdcf: ReverseDCFSnapshot | null;
  finviz: FinvizData | null;
  fcfQuality: { capexToRevenue: number | null; fcfYield: number | null; fcfGrowthYoy: number | null } | null;
  technicals: {
    rsi14: number | null;
    sma20: number | null; sma50: number | null; sma200: number | null;
    perfWeek: number | null; perfMonth: number | null; perfQuarter: number | null;
    perfHalfYear: number | null; perfYear: number | null; perfYTD: number | null;
    beta: number | null; week52High: number | null; week52Low: number | null;
    avgVol10d: number | null; avgVol3m: number | null;
    shortPercent: number | null;
    nextEarningsDate: string | null; nextEarningsHour: string | null;
  } | null;
}

export default function StockTickerPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState("overview");
  const mode = useMode();
  const visibleTabs = useMemo(() => TABS.filter(t => tabVisible(t.id, mode)), [mode]);
  // Si el modo cambia estando en una pestaña que Beginner oculta, su contenido seguiría
  // pintándose sin pestaña resaltada. Se vuelve a Overview, que existe en ambos modos.
  useEffect(() => {
    if (!tabVisible(activeTab, mode)) setActiveTab("overview");
  }, [mode, activeTab]);
  const [data, setData] = useState<StockData | null>(null);
  const [macro, setMacro] = useState<MacroState | null>(null);
  const [scores, setScores] = useState<Scores | null>(null);
  const [subScores, setSubScores] = useState<SubScores | null>(null);
  const [factorTilts, setFactorTilts] = useState<FactorTilts | null>(null);
  const [disqualifiers, setDisqualifiers] = useState<Disqualifier[]>([]);
  const [savedAnalysis, setSavedAnalysis] = useState<StockAnalysis | null>(null);
  const { macro: contextMacro, setMacro: setMacroContext } = useMacroContext();
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchProgress, setFetchProgress] = useState(0);
  const [error, setError] = useState("");
  const [failedApis, setFailedApis] = useState(0);
  const TOTAL_SOURCES = 32;
  const [watchlisted, setWatchlisted] = useState(false);
  const [watchlistId, setWatchlistId] = useState<number | null>(null);
  const [autoChecked, setAutoChecked] = useState(false);
  // Epoch guard: the App Router REUSES this component when navigating between tickers,
  // so an analyze() still in flight for the previous ticker would land late and overwrite
  // the new ticker's UI. Each ticker change / analyze call bumps the epoch; stale runs
  // see the mismatch and stop touching state (their DB upserts are keyed by their own
  // ticker, so those are allowed to finish).
  const runRef = useRef(0);

  useEffect(() => {
    if (!authLoading && !session) router.replace("/login");
  }, [session, authLoading, router]);

  useEffect(() => {
    if (!session || !ticker) return;
    runRef.current += 1; // invalidate any in-flight analyze() from the previous ticker
    setWatchlisted(false);
    setWatchlistId(null);
    // Reset analysis state so navigating between tickers re-checks the snapshot
    // and never shows the previous ticker's data.
    setHasAnalyzed(false);
    setAutoChecked(false);
    setData(null);
    setScores(null);
    setSubScores(null);
    setFactorTilts(null);
    setSavedAnalysis(null);
    setError("");
    setLoading(false);
    setFetchProgress(0);
    setFailedApis(0);
    supabase.from("sl_watchlist").select("id").eq("user_id", session.user.id).eq("ticker", ticker).maybeSingle()
      .then(({ data }) => { if (data) { setWatchlisted(true); setWatchlistId((data as { id: number }).id); } });
  }, [session, ticker]);

  async function toggleWatchlist() {
    if (!session || !ticker) return;
    if (watchlisted && watchlistId != null) {
      await supabase.from("sl_watchlist").delete().eq("id", watchlistId);
      setWatchlisted(false); setWatchlistId(null);
    } else {
      const { data } = await supabase.from("sl_watchlist").insert({ user_id: session.user.id, ticker }).select("id").single();
      if (data) { setWatchlisted(true); setWatchlistId((data as { id: number }).id); }
    }
  }

  useEffect(() => {
    if (!ticker) return;
    const name = data?.profile?.companyName as string | undefined;
    document.title = name ? `${ticker} · ${name} — Scora Research` : `${ticker} — Scora Research`;
    return () => { document.title = "Scora Research"; };
  }, [ticker, data?.profile?.companyName]);

  // Auto-load when a fresh 24h snapshot already exists — a cache HIT costs ~3 calls
  // (macro + quote + snapshot read), so this gives instant load for recently-analyzed
  // tickers without spending the FMP free-tier quota that the manual gate protects.
  // (autoChecked state declared with the other useState hooks above.)

  const analyze = useCallback(async () => {
    if (!session || !ticker) return;
    const run = ++runRef.current;
    const live = () => runRef.current === run;
    setHasAnalyzed(true);
    setLoading(true);
    setFetchProgress(0);
    setError("");

    const track = <T,>(p: PromiseLike<T>): Promise<T> =>
      Promise.resolve(p).finally(() => { if (live()) setFetchProgress(c => c + 1); });

    try {
      const today = new Date().toISOString().split("T")[0];

      // ── Always-fresh: macro + live quote ─────────────────────────
      const [macroRes, quoteRes] = await Promise.allSettled([
        track(supabase.from("macro_state").select("*").eq("id", 1).single()),
        track(authedFetch<unknown[]>(`/api/fmp/quote?symbol=${ticker}`)),
      ]);

      const macroData = macroRes.status === "fulfilled"
        ? (macroRes.value as { data: MacroState }).data
        : contextMacro;
      if (!live()) return;
      setMacro(macroData);
      if (macroData) setMacroContext(macroData);

      const freshQuote = quoteRes.status === "fulfilled"
        ? ((quoteRes.value as unknown[])?.[0] as Record<string, unknown>) ?? null
        : null;
      // FMP stable/quote renamed `changesPercentage`→`changePercentage`; alias it back
      // so the header %-change badge and any consumer of quote.changesPercentage work.
      if (freshQuote && freshQuote.changesPercentage == null && freshQuote.changePercentage != null) {
        freshQuote.changesPercentage = freshQuote.changePercentage;
      }

      // ── 24h snapshot check ────────────────────────────────────────
      const { data: snap } = await supabase
        .from("stock_snapshot")
        .select("data")
        .eq("ticker", ticker.toUpperCase())
        .eq("snapshot_date", today)
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!live()) return;
      let stockData: StockData;

      if (snap?.data) {
        stockData = { ...(snap.data as StockData), quote: freshQuote, rdcf: null, finviz: (snap.data as StockData).finviz ?? null };
        setFetchProgress(TOTAL_SOURCES);
        setFailedApis(0);
      } else {
      // ── CACHE MISS: remaining 27 fetches ─────────────────────────
      const [
        profileRes, metricsRes, ratiosRes,
        historyRes, incomeRes, balanceRes, cashRes,
        peersRes, targetsRes, estimatesRes, holdersRes,
        earningsRes, insiderRes, dcfRes,
        spyRes, congressRes, houseRes,
        annualIncomeRes, sharesFloatRes, growthRes,
        fhMetricRes, fhTargetRes, fhEarningsRes, fhRecommRes,
        fhShortRes, fhEarningsCalRes,
        edgarRes,
        simfinRes,
        finvizRes,
        shortIntRes,
      ] = await Promise.allSettled([
        track(authedFetch<unknown[]>(`/api/fmp/profile?symbol=${ticker}`)),
        track(authedFetch<unknown>(`/api/fmp/key-metrics-ttm?symbol=${ticker}`)),
        track(authedFetch<unknown>(`/api/fmp/ratios-ttm?symbol=${ticker}`)),
        track(authedFetch<unknown[]>(`/api/fmp/historical-price-eod/full?symbol=${ticker}`)),
        track(authedFetch<unknown[]>(`/api/fmp/income-statement?symbol=${ticker}&period=quarter&limit=12`)),
        track(authedFetch<unknown[]>(`/api/fmp/balance-sheet-statement?symbol=${ticker}&period=quarter&limit=12`)),
        track(authedFetch<unknown[]>(`/api/fmp/cash-flow-statement?symbol=${ticker}&period=quarter&limit=8`)),
        track(authedFetch<string[]>(`/api/fmp/peers?symbol=${ticker}`)),
        track(authedFetch<unknown[]>(`/api/fmp/price-target?symbol=${ticker}&limit=10`)),
        track(authedFetch<unknown[]>(`/api/fmp/analyst-estimates?symbol=${ticker}&limit=2`)),
        track(authedFetch<unknown[]>(`/api/fmp/institutional-holder?symbol=${ticker}`)),
        track(authedFetch<unknown[]>(`/api/fmp/earnings-surprises?symbol=${ticker}`)),
        // Insider: FMP free returns 404 here; Finnhub stock/insider-transactions is free.
        track(authedFetch<{data?: Record<string,unknown>[]}>(`/api/finnhub/stock/insider-transactions?symbol=${ticker}`)),
        track(authedFetch<unknown>(`/api/fmp/discounted-cash-flow?symbol=${ticker}`)),
        track(authedFetch<unknown[]>(`/api/fmp/historical-price-eod/full?symbol=SPY`)),
        // Congress: FMP free returns 404; use the free STOCK-Act S3 route (senate + house merged).
        track(authedFetch<unknown[]>(`/api/congress/${ticker}`)),
        track(authedFetch<unknown[]>(`/api/fmp/house-disclosure?symbol=${ticker}`)),
        track(authedFetch<unknown[]>(`/api/fmp/income-statement?symbol=${ticker}&limit=5`)),
        track(authedFetch<unknown[]>(`/api/fmp/shares-float?symbol=${ticker}`)),
        // Growth ratios (revenue/EPS YoY) — not present in stable ratios-ttm
        track(authedFetch<unknown[]>(`/api/fmp/financial-growth?symbol=${ticker}&limit=1`)),
        // Phase 1 — Finnhub fundamentals (fills gaps when FMP plan blocks endpoints)
        track(authedFetch<{metric: Record<string, number>}>(`/api/finnhub/stock/metric?symbol=${ticker}&metric=all`)),
        track(authedFetch<{targetHigh: number; targetLow: number; targetMean: number; lastUpdated: string}>(`/api/finnhub/stock/price-target?symbol=${ticker}`)),
        track(authedFetch<Record<string, unknown>[]>(`/api/finnhub/stock/earnings?symbol=${ticker}`)),
        track(authedFetch<{buy: number; hold: number; period: string; sell: number; strongBuy: number; strongSell: number}[]>(`/api/finnhub/stock/recommendation?symbol=${ticker}`)),
        // Phase 2 — short float + next earnings date (already in proxy ALLOWED)
        track(authedFetch<{data:{shortPercent:number}[]}>(`/api/finnhub/stock/short-interest?symbol=${ticker}&from=${new Date(Date.now()-90*86400000).toISOString().slice(0,10)}&to=${new Date().toISOString().slice(0,10)}`)),
        track(authedFetch<{earningsCalendar:{date:string;hour:string}[]}>(`/api/finnhub/calendar/earnings?symbol=${ticker}&from=${new Date().toISOString().slice(0,10)}&to=${new Date(Date.now()+30*86400000).toISOString().slice(0,10)}`)),
        // Phase 3 — SEC EDGAR income / balance sheet / cash flow (US stocks only; European returns empty)
        track(authedFetch<{income:Record<string,unknown>[];balanceSheet:Record<string,unknown>[];cashFlow:Record<string,unknown>[];annualIncome:Record<string,unknown>[]}>(`/api/edgar?symbol=${ticker}`)),
        // Phase 7 — SimFin financials for European stocks (requires SIMFIN_KEY in ic-proxy env)
        track(authedFetch<{income:Record<string,unknown>[];balanceSheet:Record<string,unknown>[];cashFlow:Record<string,unknown>[];annualIncome:Record<string,unknown>[]}>(`/api/simfin?symbol=${ticker}`)),
        // Phase 8 — Finviz short/sentiment/ownership data (free, edge-scraped, 6h cache)
        track(authedFetch<FinvizData>(`/api/finviz/quote?symbol=${ticker}`)),
        // Short interest / short float — free (NASDAQ official + FINRA fallback)
        track(authedFetch<{sharesShort?:number; daysToCover?:number; settlementDate?:string; shortVolumeRatio?:number}>(`/api/short-interest?symbol=${ticker}`)),
      ]);

      const quote   = freshQuote;
      const profile = profileRes.status === "fulfilled" ? (profileRes.value as unknown[])?.[0] as Record<string,unknown> ?? null : null;
      const metrics = metricsRes.status === "fulfilled" ? (Array.isArray(metricsRes.value) ? metricsRes.value[0] : metricsRes.value) as Record<string,unknown> ?? null : null;
      const ratios  = ratiosRes.status  === "fulfilled" ? (Array.isArray(ratiosRes.value)  ? ratiosRes.value[0]  : ratiosRes.value)  as Record<string,unknown> ?? null : null;

      // ── Phase 1: canonical fundamentals (FMP-stable + Finnhub, field-level) ──
      // FMP's stable API renamed/moved most ratio fields; normalizeFundamentals
      // maps both FMP and Finnhub into the legacy keys the app reads, filling each
      // field from the first non-null source. See lib/normalize.ts.
      const fhM = fhMetricRes.status === "fulfilled"
        ? (fhMetricRes.value as { metric?: Record<string, number> })?.metric ?? null
        : null;
      const fmpGrowth = growthRes.status === "fulfilled"
        ? ((growthRes.value as Record<string, unknown>[])?.[0] ?? null)
        : null;

      const { metrics: mergedMetrics, ratios: mergedRatios } = normalizeFundamentals({
        fmpKeyMetrics: metrics,
        fmpRatios:     ratios,
        fmpGrowth,
        finnhubMetric: fhM,
        profile,
      });

      // Finnhub price targets (fallback if FMP returned empty)
      const fmpTargets = targetsRes.status === "fulfilled" ? (targetsRes.value as Record<string,unknown>[]) ?? [] : [];
      const fhTarget   = fhTargetRes.status === "fulfilled"
        ? fhTargetRes.value as { targetHigh?: number; targetLow?: number; targetMean?: number; lastUpdated?: string } | null
        : null;
      const mergedTargets: Record<string, unknown>[] = fmpTargets.length > 0 ? fmpTargets
        : (fhTarget?.targetMean != null ? [{
            priceTarget:    fhTarget.targetMean,
            adjPriceTarget: fhTarget.targetMean,
            publishedDate:  fhTarget.lastUpdated ?? new Date().toISOString().slice(0, 10),
            analystName:    `High $${Number(fhTarget.targetHigh).toFixed(0)} · Low $${Number(fhTarget.targetLow).toFixed(0)}`,
            analystCompany: "Finnhub Consensus",
            action:         "Consensus",
          }] : []);

      // Finnhub earnings (fallback — component accepts both FMP and Finnhub formats)
      const fmpEarnings = earningsRes.status === "fulfilled" ? (earningsRes.value as Record<string,unknown>[]) ?? [] : [];
      const fhEarnings  = fhEarningsRes.status === "fulfilled" ? (fhEarningsRes.value as Record<string,unknown>[]) ?? [] : [];
      const mergedEarnings = fmpEarnings.length > 0 ? fmpEarnings : fhEarnings;

      // Finnhub analyst consensus (buy/hold/sell)
      const fhRecomm = fhRecommRes.status === "fulfilled"
        ? (fhRecommRes.value as { buy: number; hold: number; period: string; sell: number; strongBuy: number; strongSell: number }[]) ?? []
        : [];
      const analystConsensus = fhRecomm.length > 0 ? fhRecomm[0] : null;
      // ─────────────────────────────────────────────────────────────

      // Count truly missing sources (after FMP + Finnhub fallback)
      if (!live()) return;
      const coreFmpFailed = [quoteRes, profileRes, historyRes, incomeRes, balanceRes, cashRes, peersRes, estimatesRes, holdersRes, insiderRes, dcfRes].filter(r => r.status === "rejected").length;
      setFailedApis(
        coreFmpFailed
        + (mergedMetrics.peRatioTTM != null || mergedMetrics.roeTTM != null ? 0 : 1)
        + (mergedRatios.grossProfitMarginTTM != null || mergedRatios.revenueGrowthTTM != null ? 0 : 1)
        + (mergedTargets.length  === 0 ? 1 : 0)
        + (mergedEarnings.length === 0 ? 1 : 0)
      );

      // ── Phase 2: Technical indicators from price history + Finnhub ─
      const histData: Record<string,unknown>[] = historyRes.status === "fulfilled"
        ? (historyRes.value as Record<string,unknown>[]) ?? [] : [];
      const closes = histData.map(h => Number(h.close)).filter(v => !isNaN(v));

      const smaN = (n: number): number | null =>
        closes.length >= n ? closes.slice(0, n).reduce((a, b) => a + b, 0) / n : null;
      const perfN = (n: number): number | null =>
        closes.length > n ? ((closes[0] - closes[n]) / closes[n]) * 100 : null;
      const rsi14 = (() => {
        if (closes.length < 15) return null;
        const p = closes.slice(0, 15).reverse();
        let g = 0, l = 0;
        for (let i = 1; i < p.length; i++) { const d = p[i]-p[i-1]; if (d>0) g+=d; else l-=d; }
        return 100 - 100 / (1 + g / (l || 1e-10));
      })();
      const ytdClose = (() => {
        const yr = new Date().getFullYear().toString();
        const e = histData.find(h => !(h.date as string)?.startsWith(yr));
        return e ? Number(e.close) : null;
      })();
      const fhNum = (key: string): number | null => fhM?.[key] ?? null;

      const fhSI = fhShortRes.status === "fulfilled"
        ? (fhShortRes.value as {data?:{shortPercent?:number}[]})?.data ?? [] : [];
      const shortPercent = fhSI.length > 0 ? (fhSI[fhSI.length-1]?.shortPercent ?? null) : null;

      const fhCal = fhEarningsCalRes.status === "fulfilled"
        ? (fhEarningsCalRes.value as {earningsCalendar?:{date?:string;hour?:string}[]})?.earningsCalendar ?? [] : [];
      const nextEarning = fhCal.length > 0 ? fhCal[0] : null;

      const technicals = {
        rsi14,
        sma20: smaN(20), sma50: smaN(50), sma200: smaN(200),
        perfWeek: perfN(5), perfMonth: perfN(21), perfQuarter: perfN(63),
        perfHalfYear: perfN(126), perfYear: perfN(252),
        perfYTD: closes.length > 0 && ytdClose ? ((closes[0]-ytdClose)/ytdClose)*100 : null,
        beta:       (profile?.beta as number) ?? fhNum("beta"),
        week52High: fhNum("52WeekHigh"),
        week52Low:  fhNum("52WeekLow"),
        avgVol10d:  fhNum("10DayAverageTradingVolume"),
        avgVol3m:   fhNum("3MonthAverageTradingVolume"),
        shortPercent,
        nextEarningsDate: nextEarning?.date ?? null,
        nextEarningsHour: nextEarning?.hour ?? null,
      };
      // ─────────────────────────────────────────────────────────────

      const sector = (profile?.sector as string) ?? "";
      const sectorEtfSymbol = SECTOR_ETF[sector] ?? "SPY";

      let sectorEtfHistory: Record<string, unknown>[] = [];
      if (sectorEtfSymbol === "SPY") {
        sectorEtfHistory = spyRes.status === "fulfilled" ? (spyRes.value as Record<string,unknown>[]) ?? [] : [];
      } else {
        try {
          const etfRes = await authedFetch<unknown[]>(`/api/fmp/historical-price-eod/full?symbol=${sectorEtfSymbol}`);
          sectorEtfHistory = Array.isArray(etfRes) ? etfRes as Record<string,unknown>[] : [];
        } catch { /* silent */ }
      }

      // ── Phase 3+7: SEC EDGAR (US) + SimFin (European) merge ──────────────────
      type FinData = { income: Record<string,unknown>[]; balanceSheet: Record<string,unknown>[]; cashFlow: Record<string,unknown>[]; annualIncome: Record<string,unknown>[] };
      const edgar:  FinData | null = edgarRes.status  === "fulfilled" ? edgarRes.value  as FinData : null;
      const simfin: FinData | null = simfinRes.status === "fulfilled" ? simfinRes.value as FinData : null;
      const fmpIncome   = incomeRes.status       === "fulfilled" ? (incomeRes.value       as Record<string,unknown>[]) ?? [] : [];
      const fmpBalance  = balanceRes.status      === "fulfilled" ? (balanceRes.value      as Record<string,unknown>[]) ?? [] : [];
      const fmpCashFlow = cashRes.status         === "fulfilled" ? (cashRes.value         as Record<string,unknown>[]) ?? [] : [];
      const fmpAnnual   = annualIncomeRes.status === "fulfilled" ? (annualIncomeRes.value as Record<string,unknown>[]) ?? [] : [];
      // Priority: FMP (if any data) → EDGAR (US stocks) → SimFin (European stocks)
      const mergedIncome       = fmpIncome.length   > 0 ? fmpIncome   : (edgar?.income        ?? simfin?.income        ?? []);
      const mergedBalance      = fmpBalance.length  > 0 ? fmpBalance  : (edgar?.balanceSheet  ?? simfin?.balanceSheet  ?? []);
      const mergedCashFlow     = fmpCashFlow.length > 0 ? fmpCashFlow : (edgar?.cashFlow      ?? simfin?.cashFlow      ?? []);
      const mergedAnnualIncome = fmpAnnual.length   > 0 ? fmpAnnual   : (edgar?.annualIncome  ?? simfin?.annualIncome  ?? []);
      // ─────────────────────────────────────────────────────────────

      // ── Phase 8: Finviz + Finnhub fallback ───────────────────────
      // Finviz blocks Vercel's IPs, so its scrape usually returns {}. Fill the
      // Sentiment tab from Finnhub metric/recommendation/price-target; real Finviz
      // wins per-field when it does come through.
      const finvizData: FinvizData | null = finvizRes.status === "fulfilled"
        ? (finvizRes.value as FinvizData) ?? null
        : null;
      let finvizMerged = mergeFinviz(
        finvizData,
        finnhubToFinvizFallback(fhM, analystConsensus, fhTarget),
      );
      // Short float: NASDAQ short interest ÷ float (both free); FINRA short-volume
      // ratio as the fallback. Overlays onto the Sentiment tab's Short Interest cells.
      const shortInt = shortIntRes.status === "fulfilled"
        ? (shortIntRes.value as { sharesShort?: number; daysToCover?: number; settlementDate?: string; shortVolumeRatio?: number }) ?? null
        : null;
      const floatShares = (() => {
        const sf = sharesFloatRes.status === "fulfilled" ? (sharesFloatRes.value as Record<string, unknown>[]) ?? [] : [];
        const v = sf?.[0]?.floatShares ?? sf?.[0]?.outstandingShares;
        return v != null ? Number(v) : null;
      })();
      const shortFloatPct = shortInt?.sharesShort != null && floatShares && floatShares > 0
        ? shortInt.sharesShort / floatShares : null;
      if (shortInt && (shortFloatPct != null || shortInt.daysToCover != null || shortInt.shortVolumeRatio != null)) {
        finvizMerged = {
          ...(finvizMerged ?? ({} as FinvizData)),
          shortFloat:       finvizMerged?.shortFloat ?? shortFloatPct,
          shortRatio:       finvizMerged?.shortRatio ?? shortInt.daysToCover ?? null,
          shortVolumeRatio: shortInt.shortVolumeRatio ?? null,
        } as FinvizData;
      }
      // ─────────────────────────────────────────────────────────────

      stockData = {
        quote, profile,
        metrics: mergedMetrics,
        ratios:  mergedRatios,
        history:              historyRes.status  === "fulfilled" ? (historyRes.value  as Record<string,unknown>[]) ?? [] : [],
        income:               mergedIncome,
        balanceSheet:         mergedBalance,
        cashFlow:             mergedCashFlow,
        peers:                peersRes.status    === "fulfilled" ? (peersRes.value    as string[]) ?? [] : [],
        priceTargets:         mergedTargets,
        analystEstimates:     estimatesRes.status === "fulfilled" ? (estimatesRes.value as Record<string,unknown>[]) ?? [] : [],
        institutionalHolders: holdersRes.status  === "fulfilled" ? (holdersRes.value  as Record<string,unknown>[]) ?? [] : [],
        earningsSurprises:    mergedEarnings,
        insiderTrades:        insiderRes.status  === "fulfilled" ? ((insiderRes.value as {data?:Record<string,unknown>[]})?.data ?? []) : [],
        dcf:                  dcfRes.status === "fulfilled" ? (Array.isArray(dcfRes.value) ? dcfRes.value[0] : dcfRes.value) as Record<string,unknown> ?? null : null,
        spyHistory:           spyRes.status === "fulfilled" ? (spyRes.value as Record<string,unknown>[]) ?? [] : [],
        sectorEtfHistory,
        sectorEtfSymbol,
        congressTrades:       congressRes.status === "fulfilled" ? (congressRes.value as Record<string,unknown>[]) ?? [] : [],
        houseDisclosures:     houseRes.status    === "fulfilled" ? (houseRes.value    as Record<string,unknown>[]) ?? [] : [],
        annualIncome:         mergedAnnualIncome,
        sharesFloat:          sharesFloatRes.status  === "fulfilled" ? (sharesFloatRes.value  as Record<string,unknown>[]) ?? [] : [],
        analystConsensus,
        rdcf: null,
        finviz: finvizMerged,
        fcfQuality: null,
        technicals,
      };

      // ── Write 24h snapshot (exclude quote/rdcf, cap history arrays) ──
      // Skip when core data is missing (e.g. FMP rate-limited): caching an empty
      // payload would poison every re-analyze for the rest of the day.
      const snapshotWorthSaving = stockData.profile != null || stockData.income.length > 0 || stockData.history.length > 0;
      const { quote: _snapQ, rdcf: _snapR, history: _sh, spyHistory: _ss, sectorEtfHistory: _se, ...snapRest } = stockData;
      if (snapshotWorthSaving) await supabase.from("stock_snapshot").upsert({
        ticker: ticker.toUpperCase(),
        snapshot_date: today,
        user_id: session.user.id,
        data: {
          ...snapRest,
          history:          _sh.slice(0, 252),
          spyHistory:       _ss.slice(0, 252),
          sectorEtfHistory: _se.slice(0, 252),
        },
      }, { onConflict: "ticker,snapshot_date,user_id" });

      } // end cache miss

      // ── Common: RDCF + scoring + upsert ──────────────────────────
      if (!live()) return;
      setData(stockData);

      const mergedMetrics = stockData.metrics;
      const mergedRatios  = stockData.ratios;
      const quote         = stockData.quote;
      const sector        = (stockData.profile?.sector as string) ?? "";

      // ── Reverse DCF (auto) ────────────────────────────────────────
      const rdcfRevTTM  = stockData.income.slice(0, 4).reduce((s, q) => s + (Number(q.revenue) || 0), 0);
      const rdcfFcfTTM  = stockData.cashFlow.slice(0, 4).reduce((s, q) =>
        s + ((Number(q.operatingCashFlow) || 0) + (Number(q.capitalExpenditure) || 0)), 0);
      const rdcfNetDebt = stockData.balanceSheet[0]
        ? (Number(stockData.balanceSheet[0].totalDebt) || 0) - (Number(stockData.balanceSheet[0].cashAndCashEquivalents) || 0)
        : 0;
      const rdcfShares = (mergedMetrics?.weightedAverageSharesOutstandingDilutedTTM as number)
        ?? (quote?.marketCap != null && Number(quote.price ?? 0) > 0
            ? Number(quote.marketCap) / Number(quote.price)
            : null);
      const rdcfPrice = Number(quote?.price ?? 0);
      const rdcfBeta  = (stockData.technicals?.beta ?? (mergedMetrics as Record<string,unknown>)?.beta as number) ?? 1.0;
      const rdcfRf    = macroData?.dgs10 != null ? Number(macroData.dgs10) : 4.2;

      const rdcfResult = rdcfRevTTM > 0 && rdcfShares != null && rdcfShares > 0 && rdcfPrice > 0
        ? computeReverseDCF({
            currentPrice:  rdcfPrice,
            revenueTTM:    rdcfRevTTM,
            fcfMarginTTM:  rdcfRevTTM > 0 ? rdcfFcfTTM / rdcfRevTTM : 0,
            netDebt:       rdcfNetDebt,
            sharesOut:     rdcfShares,
            beta:          rdcfBeta,
            rfRate:        rdcfRf,
            creditStress:  macroData?.credit_stress ?? null,
          })
        : null;

      const rdcfSnapshot: ReverseDCFSnapshot | null = rdcfResult
        ? { ...rdcfResult, computedAt: new Date().toISOString() }
        : null;

      // ── FCF quality metrics (Features 1, 2, 6) ───────────────────
      const ttmCapex     = stockData.cashFlow.slice(0, 4).reduce((s, q) => s + Math.abs(Number(q.capitalExpenditure) || 0), 0);
      const ttmRevenue   = stockData.income.slice(0, 4).reduce((s, q) => s + (Number(q.revenue) || 0), 0);
      const prevFcf      = stockData.cashFlow.slice(4, 8).reduce((s, q) =>
        s + ((Number(q.operatingCashFlow) || 0) + (Number(q.capitalExpenditure) || 0)), 0);
      const ttmFcfForYoy = stockData.cashFlow.slice(0, 4).reduce((s, q) =>
        s + ((Number(q.operatingCashFlow) || 0) + (Number(q.capitalExpenditure) || 0)), 0);
      const capexToRevenue = ttmRevenue > 0 && ttmCapex >= 0 ? ttmCapex / ttmRevenue : null;
      const fcfYield       = quote?.marketCap != null && Number(quote.marketCap) > 0 && ttmFcfForYoy !== 0
        ? ttmFcfForYoy / Number(quote.marketCap) : null;
      const fcfGrowthYoy   = prevFcf !== 0 && Math.abs(prevFcf) > 1e4
        ? ((ttmFcfForYoy - prevFcf) / Math.abs(prevFcf)) * 100 : null;
      // ─────────────────────────────────────────────────────────────

      stockData.rdcf = rdcfSnapshot;
      stockData.fcfQuality = { capexToRevenue, fcfYield, fcfGrowthYoy };
      if (!live()) return;
      setData({ ...stockData });

      // Compute momentum from daily close prices (history is newest-first from FMP)
      const cl = stockData.history.map(h => Number(h.close)).filter(v => !isNaN(v));
      const priceChange1M = cl.length > 22  ? ((cl[0] - cl[22])  / cl[22])  * 100 : null;
      const priceChange3M = cl.length > 63  ? ((cl[0] - cl[63])  / cl[63])  * 100 : null;
      const priceChange6M = cl.length > 126 ? ((cl[0] - cl[126]) / cl[126]) * 100 : null;

      const scoreInputs = {
        pe:               mergedMetrics?.peRatioTTM as number ?? null,
        pb:               mergedMetrics?.priceToBookRatioTTM as number ?? null,
        evEbitda:         mergedMetrics?.enterpriseValueOverEBITDATTM as number ?? null,
        pfcf:             mergedMetrics?.priceToFreeCashFlowsRatioTTM as number ?? null,
        debtEquity:       mergedRatios?.debtEquityRatioTTM as number ?? null,
        currentRatio:     mergedRatios?.currentRatioTTM as number ?? null,
        interestCoverage: mergedRatios?.interestCoverageTTM as number ?? null,
        netDebtEbitda:    mergedMetrics?.netDebtToEBITDATTM as number ?? null,
        roic:             mergedMetrics?.roicTTM != null ? (mergedMetrics.roicTTM as number) * 100 : null,
        roe:              mergedMetrics?.roeTTM  != null ? (mergedMetrics.roeTTM  as number) * 100 : null,
        roa:              mergedRatios?.returnOnAssetsTTM != null ? (mergedRatios.returnOnAssetsTTM as number) * 100 : null,
        netMargin:        mergedRatios?.netProfitMarginTTM != null ? (mergedRatios.netProfitMarginTTM as number) * 100 : null,
        grossMargin:      mergedRatios?.grossProfitMarginTTM != null ? (mergedRatios.grossProfitMarginTTM as number) * 100 : null,
        // GP/assets (Novy-Marx gross profitability) = grossMargin × assetTurnover — both already normalized; null → graceful no-op.
        grossProfitability: mergedRatios?.grossProfitMarginTTM != null && mergedRatios?.assetTurnoverTTM != null
          ? (mergedRatios.grossProfitMarginTTM as number) * (mergedRatios.assetTurnoverTTM as number) * 100 : null,
        revenueGrowth:    mergedRatios?.revenueGrowthTTM != null ? (mergedRatios.revenueGrowthTTM as number) * 100 : null,
        epsGrowth:        mergedRatios?.netIncomeGrowthTTM != null ? (mergedRatios.netIncomeGrowthTTM as number) * 100 : null,
        marketCap:        quote?.marketCap as number ?? null,
        regime:           macroData?.regime_id ?? null,
        sector,
        priceChange1M, priceChange3M, priceChange6M,
        impliedGrowthCagr: rdcfResult?.impliedGrowthCagr ?? null,
        tvShare:           rdcfResult?.tvShare ?? null,
        // FCF quality signals
        capexToRevenue,
        fcfYield,
        fcfGrowthYoy,
        // Finviz signals
        shortFloat:       stockData.finviz?.shortFloat ?? null,
        instTrans:        stockData.finviz?.instTrans ?? null,
        insiderTrans:     stockData.finviz?.insiderTrans ?? null,
        relVolume:        stockData.finviz?.relVolume ?? null,
        forwardPe:        stockData.finviz?.forwardPe ?? null,
        epsQoQ:           stockData.finviz?.epsQoQ ?? null,
        salesQoQ:         stockData.finviz?.salesQoQ ?? null,
        operatingMargin:  stockData.finviz?.operatingMargin ?? null,
      };
      // F2: el score se juzga contra la distribución del SECTOR cuando está disponible.
      // `loadFactorDist()` degrada a null si el fichero no está publicado, y entonces
      // calcScores cae a las bandas absolutas de siempre — la nota nunca deja de calcularse.
      const factorDist = await loadFactorDist();          // grados y descalificadores
      const scoringDist = await distForScoring();        // null: no validado contra retornos
      const calc = calcScores(scoreInputs, scoringDist);
      // Factor profile (value/growth/momentum/quality/size) → feeds the measured regime→factor
      // tilt in getMacroTilt (growth favored in expansion/reflation, value in contraction).
      const ftilts = calcFactorTilts(scoreInputs);
      const macroTiltData = macroData ? getMacroTilt(macroData, sector, ftilts) : null;
      // P0-3: un pilar en el decil inferior de su sector TOPA la nota. Sin `factorDist`
      // la lista sale vacía y el rating es el de siempre.
      const disq = findDisqualifiers(scoreInputs, factorDist);
      if (!live()) return;
      setScores(calc);
      setSubScores(calcSubScores(scoreInputs));
      setFactorTilts(ftilts);
      setDisqualifiers(disq);

      const rating = getRating(calc.total, disq);
      const { data: saved } = await supabase.from("sl_analyses").upsert({
        user_id: session.user.id,
        ticker: ticker.toUpperCase(),
        analysis_date: today,
        score_total: calc.total,
        score_val: calc.value,
        score_hlth: calc.health,
        score_mom: calc.momentum,
        score_growth: calc.growth,
        rating: rating.label,
        // Con qué fórmula se calculó ESTE análisis. Sin esto, el historial del usuario
        // mezclaría notas de dos metodologías distintas sin que nada lo indicara: vería
        // "la nota de X bajó" sin poder saber si bajó la empresa o cambió la regla.
        score_version: SCORE_USES_SECTOR_PERCENTILES ? SCORE_VERSION_SECTOR_PCTL : SCORE_VERSION_ABSOLUTE_BANDS,
        macro_tilt: macroTiltData?.tilt ?? null,
        sector,
        reverse_dcf: rdcfSnapshot,
        // P1-8 valuation multiples (raw ratios; roic & fcf_yield as %)
        pe:        (mergedMetrics?.peRatioTTM as number) ?? null,
        ev_ebitda: (mergedMetrics?.enterpriseValueOverEBITDATTM as number) ?? null,
        pfcf:      (mergedMetrics?.priceToFreeCashFlowsRatioTTM as number) ?? null,
        roic:      mergedMetrics?.roicTTM != null ? (mergedMetrics.roicTTM as number) * 100 : null,
        fcf_yield: fcfYield != null ? fcfYield * 100 : null,
      }, { onConflict: "ticker,analysis_date,user_id" }).select().single();

      if (saved && live()) setSavedAnalysis(saved as StockAnalysis);

      // ── Live track record: immutable score snapshot (append-only, 1/ticker/day) ──
      // Seals the score with a timestamp and the point-in-time price, so realized
      // forward return vs SPY can be measured later. The table has no UPDATE/DELETE
      // policy and we insert do-nothing-on-conflict, so the record can't be curated.
      const icForLog = Math.round(Math.max(0, Math.min(100, calc.total + (macroTiltData?.tilt ?? 0))));
      await supabase.from("sl_score_log").upsert({
        user_id: session.user.id,
        ticker: ticker.toUpperCase(),
        score_date: today,
        score_total: calc.total,
        ic_score: icForLog,
        macro_tilt: macroTiltData?.tilt ?? null,
        rating: getRating(icForLog).label,
        sector,
        regime_id: macroData?.regime_id ?? null,
        price_at_score: quote?.price != null ? Number(quote.price) : null,
      }, { onConflict: "user_id,ticker,score_date", ignoreDuplicates: true });

    } catch (e) {
      if (live()) setError(e instanceof Error ? e.message : "Analysis failed");
    }
    if (live()) setLoading(false);
  }, [session, ticker]);

  useEffect(() => {
    if (!session || !ticker || hasAnalyzed || autoChecked) return;
    const today = new Date().toISOString().split("T")[0];
    supabase.from("stock_snapshot").select("ticker")
      .eq("ticker", ticker.toUpperCase()).eq("snapshot_date", today).eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data: snap }) => {
        setAutoChecked(true);
        if (snap) analyze();  // fresh snapshot → cheap cache-hit load
      });
  }, [session, ticker, hasAnalyzed, autoChecked, analyze]);

  // Technical state for in-app alert evaluation (crossed_sma150 / base_breakout / stage_change).
  const techState = useMemo(() => {
    const hist = data?.history ?? [];
    if (hist.length < 31) return null;
    const ohlcv: OHLCV[] = hist.slice(0, 260)
      .map(h => ({ open: Number(h.open), high: Number(h.high), low: Number(h.low), close: Number(h.close), volume: Number(h.volume) }))
      .filter(b => isFinite(b.close) && isFinite(b.high) && isFinite(b.low))
      .reverse();
    if (ohlcv.length < 31) return null;
    const stage = trendStage(ohlcv);
    const bb = detectBaseBreakout(ohlcv);
    return {
      aboveSma150: stage.aboveSma150,
      stage: stage.stage,
      baseBreakout: bb.status === "base-breakout" && bb.volumeConfirmed && bb.aboveTrend,
    };
  }, [data]);

  if (authLoading || !session) return null;

  const profile = data?.profile;
  const quote   = data?.quote;
  const sector  = (profile?.sector as string) ?? "";
  const macroTilt = macro ? getMacroTilt(macro, sector, factorTilts) : null;
  const icScore   = scores && macroTilt ? Math.max(0, Math.min(100, scores.total + macroTilt.tilt)) : null;
  const rating    = icScore != null ? getRating(icScore, disqualifiers) : (scores ? getRating(scores.total, disqualifiers) : null);

  const ipoDate     = profile?.ipoDate as string | undefined;
  const isRecentIPO = ipoDate
    ? (Date.now() - new Date(ipoDate).getTime()) < 3 * 365 * 24 * 3600 * 1000
    : false;

  function exportCSV() {
    if (!data) return;
    const rows: [string, string][] = [
      ["Ticker", ticker],
      ["Company", String(profile?.companyName ?? "")],
      ["Sector", String(profile?.sector ?? "")],
      ["Price", String(quote?.price ?? "")],
      ["Market Cap", String(quote?.marketCap ?? "")],
      ["Scora Score", String(icScore?.toFixed(0) ?? "")],
      ["Rating", rating?.label ?? ""],
      ["Value Score", String(scores?.value ?? "")],
      ["Health Score", String(scores?.health ?? "")],
      ["Momentum Score", String(scores?.momentum ?? "")],
      ["Growth Score", String(scores?.growth ?? "")],
      ["Macro Tilt", String(macroTilt?.tilt ?? "")],
      ["P/E", String(data.metrics?.peRatioTTM ?? "")],
      ["EV/EBITDA", String(data.metrics?.enterpriseValueOverEBITDATTM ?? "")],
      ["ROIC %", data.metrics?.roicTTM != null ? ((data.metrics.roicTTM as number)*100).toFixed(1) : ""],
      ["Net Debt/EBITDA", String(data.metrics?.netDebtToEBITDATTM ?? "")],
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`; // RFC-4180 quote-escaping
    const csv = rows.map(([k, v]) => `${esc(k)},${esc(v)}`).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${ticker}_scora_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{
        position: "sticky", top: "var(--sr-nav-h)", zIndex: 50,
        background: "color-mix(in srgb, var(--sr-bg) 95%, transparent)",
        backdropFilter: "blur(8px)", borderBottom: "1px solid var(--sr-border)",
      }}>
        {/* Stock info bar */}
        <div style={{ padding: "var(--sr-sp-3) var(--sr-sp-6)", display: "flex", alignItems: "center", gap: "var(--sr-sp-4)", borderBottom: "1px solid var(--sr-border)" }}>
          <button
            onClick={() => router.push("/stock")}
            style={{ background: "none", border: "none", color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)", cursor: "pointer" }}
          >
            ← Stocks
          </button>
          <div style={{ width: 1, height: 16, background: "var(--sr-border)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-2)", flex: 1 }}>
            <span style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{ticker}</span>
            {isRecentIPO && (
              <span style={{
                fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em",
                padding: "2px 7px", borderRadius: "var(--sr-radius-pill)",
                background: "color-mix(in srgb, #8B5CF6 15%, transparent)",
                color: "#A78BFA", border: "1px solid color-mix(in srgb, #8B5CF6 35%, transparent)",
              }}>
                IPO {ipoDate?.slice(0, 7)}
              </span>
            )}
            {profile?.companyName != null && (
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>{String(profile.companyName)}</span>
            )}
            {data?.technicals?.nextEarningsDate && (
              <span style={{
                fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", flexShrink: 0,
                padding: "2px 7px", borderRadius: "var(--sr-radius-pill)",
                background: "color-mix(in srgb, var(--sr-amber) 12%, transparent)",
                color: "var(--sr-amber)", border: "1px solid color-mix(in srgb, var(--sr-amber) 30%, transparent)",
              }}>
                ER {data.technicals.nextEarningsDate.slice(5)}{data.technicals.nextEarningsHour === "amc" ? " AMC" : data.technicals.nextEarningsHour === "bmo" ? " BMO" : ""}
              </span>
            )}
          </div>
          {quote?.price != null && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-4)", flexShrink: 0 }}>
              <span style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">
                ${(quote.price as number).toFixed(2)}
              </span>
              {quote.changesPercentage != null && (
                <span style={{
                  fontSize: "var(--sr-t-sm)", fontWeight: 600,
                  color: (quote.changesPercentage as number) >= 0 ? "var(--sr-pos)" : "var(--sr-neg)",
                }} className="num">
                  {(quote.changesPercentage as number) >= 0 ? "+" : ""}{(quote.changesPercentage as number).toFixed(2)}%
                </span>
              )}
            </div>
          )}
          <button
            onClick={toggleWatchlist}
            title={watchlisted ? "Quitar de watchlist" : "Agregar a watchlist"}
            style={{
              background: watchlisted ? "color-mix(in srgb, var(--sr-amber) 15%, transparent)" : "var(--sr-surface-2)",
              border: `1px solid ${watchlisted ? "color-mix(in srgb, var(--sr-amber) 40%, transparent)" : "var(--sr-border)"}`,
              borderRadius: "var(--sr-radius)", cursor: "pointer", flexShrink: 0,
              fontSize: "16px", padding: "4px 10px", lineHeight: 1,
              color: watchlisted ? "var(--sr-amber)" : "var(--sr-text-3)",
            }}
          >
            {watchlisted ? "★" : "☆"}
          </button>
          {!loading && data && (
            <button
              onClick={exportCSV}
              style={{
                background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)",
                borderRadius: "var(--sr-radius)", color: "var(--sr-text-2)",
                fontSize: "var(--sr-t-xs)", padding: "5px 10px", cursor: "pointer", flexShrink: 0,
              }}
            >
              ↓ CSV
            </button>
          )}
        </div>

        {/* Sub-tabs */}
        <div style={{ padding: "0 var(--sr-sp-6)", display: "flex", gap: "var(--sr-sp-1)", height: "var(--sr-subnav-h)", alignItems: "center", overflowX: "auto" }}>
          {visibleTabs.map(t => (
            <button
              key={t.id}
              className={`subtab ${activeTab === t.id ? "active" : ""}`}
              onClick={(e) => { setActiveTab(t.id); track("tab_opened", { page: "stock", tab: t.id }); e.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest" }); }}
            >
              {t.label}
            </button>
          ))}
          {/* Beginner recorta la superficie, no cambia un solo número: el motor es el
              mismo y las mismas entradas dan la misma llamada en los dos modos. */}
          <button
            type="button"
            className="subtab"
            onClick={() => { const next = mode === "pro" ? "beginner" : "pro"; setMode(next); track("tab_opened", { page: "stock", tab: `mode:${next}` }); }}
            title={mode === "pro" ? `Show only the ${BEGINNER_TABS.length} essential tabs` : "Show all tabs"}
            style={{ marginLeft: "auto", flexShrink: 0, color: "var(--sr-text-3)" }}
          >
            {mode === "pro" ? "Beginner view" : `Pro view (${TABS.length} tabs)`}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "var(--sr-sp-6)", maxWidth: 1200, margin: "0 auto" }}>
        {!hasAnalyzed ? (
          /* ── Analyze gate ── */
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 480, textAlign: "center", gap: "var(--sr-sp-5)" }}>
            <div>
              <div style={{ fontSize: "var(--sr-t-3xl)", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "var(--sr-sp-2)" }}>
                {ticker}
              </div>
              <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", maxWidth: 440, lineHeight: 1.7 }}>
                Fetch fundamentals, valuation, momentum, insider activity, macro overlay and more for this ticker.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-1)", alignItems: "center" }}>
              {[
                "Overview · Fundamentals · Valuation · Chart",
                "Research · Smart Money · Screener · Compare",
                "Macro tilt overlay from current regime",
                "Score saved to watchlist automatically",
              ].map(line => (
                <div key={line} style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", display: "flex", alignItems: "center", gap: "var(--sr-sp-2)" }}>
                  <span style={{ color: "var(--sr-amber)", fontSize: 8 }}>▶</span>
                  {line}
                </div>
              ))}
            </div>
            <button
              className="btn-primary"
              onClick={() => analyze()}
              disabled={loading}
              style={{ padding: "12px 36px", fontSize: "var(--sr-t-base)", fontWeight: 700, marginTop: "var(--sr-sp-2)" }}
            >
              {loading ? "Analyzing…" : `Analyze ${ticker}`}
            </button>
            {loading && (
              <div style={{ width: 320, textAlign: "center" }}>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-2)" }}>
                  Fetching {fetchProgress} / {TOTAL_SOURCES} data sources…
                </div>
                <div style={{ height: 4, background: "var(--sr-surface-3)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min(100, (fetchProgress / TOTAL_SOURCES) * 100)}%`,
                    background: "var(--sr-amber)",
                    borderRadius: 2,
                    transition: "width 200ms ease",
                  }} />
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Tab content — only mounts after analyze ── */
          <>
            {error && (
              <div style={{ padding: "var(--sr-sp-3) var(--sr-sp-4)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-sm)", marginBottom: "var(--sr-sp-5)" }}>
                {error}
              </div>
            )}
            {!error && failedApis > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-2)", padding: "var(--sr-sp-2) var(--sr-sp-4)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-warn) 8%, transparent)", color: "var(--sr-warn)", fontSize: "var(--sr-t-xs)", marginBottom: "var(--sr-sp-4)", border: "1px solid color-mix(in srgb, var(--sr-warn) 20%, transparent)" }}>
                ⚠ {failedApis} data source{failedApis > 1 ? "s" : ""} unavailable — some fields may show "—"
              </div>
            )}
            {/* Answer-first: the call, three reasons and the falsifier — above every tab,
                so the first five seconds answer the question instead of presenting
                thirteen tabs of raw material. Depth stays exactly where it was. */}
            <Verdict data={data} macro={macro} scores={scores} icScore={icScore} loading={loading} />

            {activeTab === "overview"     && (
              <>
                <StockOverview data={data} macro={macro} scores={scores} icScore={icScore} rating={rating} macroTilt={macroTilt} loading={loading} ticker={ticker} savedAnalysis={savedAnalysis} />
                {data && <AlertConfig ticker={ticker} price={quote?.price as number ?? null} ratingLabel={rating?.label ?? null} rdcfUpside={data?.rdcf?.upside ?? null} tech={techState} />}
              </>
            )}
            {activeTab === "signals"      && <StockSignals    subScores={subScores} data={data} rf={macro?.dgs10 as number ?? null} factorTilts={factorTilts} />}
            {activeTab === "riskmodel"    && <RiskModel      ticker={ticker} data={data} />}
            {activeTab === "governance"   && <Governance     ticker={ticker} data={data} rf={macro?.dgs10 as number ?? null} />}
            {activeTab === "fundamentals" && (
              <>
                <StockFundamentals data={data} loading={loading} ticker={ticker} />
                <FlujoDeCaja data={data} loading={loading} />
                {data && <RevenueForecast data={data} />}
              </>
            )}
            {activeTab === "valuation"    && (
              <>
                <StockValuation   data={data} macro={macro} loading={loading} ticker={ticker} />
                {data && <ValuationLab data={data} macro={macro} />}
              </>
            )}
            {activeTab === "report"       && <StockReport      data={data} macro={macro} scores={scores} icScore={icScore} loading={loading} ticker={ticker} />}
            {activeTab === "diligence"    && <DueDiligence     data={data} macro={macro} scores={scores} icScore={icScore} loading={loading} ticker={ticker} />}
            {activeTab === "chart"        && <StockChart       data={data} loading={loading} ticker={ticker} icScore={icScore} dgs2={macro?.dgs2 as number ?? null} />}
            {activeTab === "research"     && <StockResearch    data={data} scores={scores} loading={loading} ticker={ticker} macro={macro} macroTilt={macroTilt} />}
            {activeTab === "smartmoney"   && <StockSmartMoney  data={data} loading={loading} ticker={ticker} />}
            {activeTab === "sentiment"    && <StockSentiment   data={data} loading={loading} />}
            {activeTab === "news"         && <StockNews        ticker={ticker} />}
            {activeTab === "options"      && (
              <>
                <OptionsLab  ticker={ticker} price={quote?.price as number ?? null} rate={macro?.dgs10 as number ?? null} history={data?.history} score={icScore} />
                <OptionsCalc ticker={ticker} price={quote?.price as number ?? null} rate={macro?.dgs10 as number ?? null} />
              </>
            )}
            {activeTab === "screener"     && <StockScreener />}
            {activeTab === "compare"      && <StockCompare     ticker={ticker} peers={data?.peers ?? []} />}
          </>
        )}
      </div>
    </div>
  );
}
