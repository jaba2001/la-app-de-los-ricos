"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/proxy";
import { calcScores, getRating, getMacroTilt, SECTOR_ETF } from "@/lib/scoring";
import type { MacroState, Scores, StockAnalysis } from "@/lib/types";
import dynamic from "next/dynamic";
import { Sk } from "@/components/ui/Skeleton";

const TabSk = () => <Sk w="100%" h={500} />;

const StockOverview     = dynamic(() => import("@/components/stock/StockOverview"),     { loading: TabSk, ssr: false });
const StockFundamentals = dynamic(() => import("@/components/stock/StockFundamentals"), { loading: TabSk, ssr: false });
const StockValuation    = dynamic(() => import("@/components/stock/StockValuation"),    { loading: TabSk, ssr: false });
const StockChart        = dynamic(() => import("@/components/stock/StockChart"),        { loading: TabSk, ssr: false });
const StockResearch     = dynamic(() => import("@/components/stock/StockResearch"),     { loading: TabSk, ssr: false });
const StockSmartMoney   = dynamic(() => import("@/components/stock/StockSmartMoney"),   { loading: TabSk, ssr: false });
const StockScreener     = dynamic(() => import("@/components/stock/StockScreener"),     { loading: TabSk, ssr: false });
const StockCompare      = dynamic(() => import("@/components/stock/StockCompare"),      { loading: TabSk, ssr: false });

const TABS = [
  { id: "overview",      label: "Overview" },
  { id: "fundamentals",  label: "Fundamentals" },
  { id: "valuation",     label: "Valuation" },
  { id: "chart",         label: "Chart" },
  { id: "research",      label: "Research" },
  { id: "smartmoney",    label: "Smart Money" },
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
}

export default function StockTickerPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState("overview");
  const [data, setData] = useState<StockData | null>(null);
  const [macro, setMacro] = useState<MacroState | null>(null);
  const [scores, setScores] = useState<Scores | null>(null);
  const [savedAnalysis, setSavedAnalysis] = useState<StockAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [failedApis, setFailedApis] = useState(0);

  useEffect(() => {
    if (!authLoading && !session) router.replace("/login");
  }, [session, authLoading, router]);

  useEffect(() => {
    if (!ticker) return;
    const name = data?.profile?.companyName as string | undefined;
    document.title = name ? `${ticker} · ${name} — Scora Research` : `${ticker} — Scora Research`;
    return () => { document.title = "Scora Research"; };
  }, [ticker, data?.profile?.companyName]);

  const analyze = useCallback(async () => {
    if (!session || !ticker) return;
    setLoading(true);
    setError("");

    try {
      const [
        macroRes,
        quoteRes, profileRes, metricsRes, ratiosRes,
        historyRes, incomeRes, balanceRes, cashRes,
        peersRes, targetsRes, estimatesRes, holdersRes,
        earningsRes, insiderRes, dcfRes,
        spyRes, congressRes, houseRes,
        annualIncomeRes, sharesFloatRes,
      ] = await Promise.allSettled([
        supabase.from("macro_state").select("*").eq("id", 1).single(),
        authedFetch<unknown[]>(`/api/fmp/quote?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/profile?symbol=${ticker}`),
        authedFetch<unknown>(`/api/fmp/key-metrics-ttm?symbol=${ticker}`),
        authedFetch<unknown>(`/api/fmp/ratios-ttm?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/historical-price-eod/full?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/income-statement?symbol=${ticker}&quarter=true&limit=12`),
        authedFetch<unknown[]>(`/api/fmp/balance-sheet-statement?symbol=${ticker}&quarter=true&limit=12`),
        authedFetch<unknown[]>(`/api/fmp/cash-flow-statement?symbol=${ticker}&quarter=true&limit=8`),
        authedFetch<string[]>(`/api/fmp/peers?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/price-target?symbol=${ticker}&limit=10`),
        authedFetch<unknown[]>(`/api/fmp/analyst-estimates?symbol=${ticker}&limit=2`),
        authedFetch<unknown[]>(`/api/fmp/institutional-holder/${ticker}`),
        authedFetch<unknown[]>(`/api/finnhub/stock/earnings?symbol=${ticker}&limit=8`),
        authedFetch<{ data?: unknown[] }>(`/api/finnhub/stock/insider-transactions?symbol=${ticker}`),
        authedFetch<unknown>(`/api/fmp/discounted-cash-flow?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/historical-price-eod/full?symbol=SPY`),
        authedFetch<unknown[]>(`/api/fmp/senate-trading?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/house-disclosure?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/income-statement?symbol=${ticker}&limit=5`),
        authedFetch<unknown[]>(`/api/fmp/historical-shares-float?symbol=${ticker}&limit=10`),
      ]);

      const macroData = macroRes.status === "fulfilled" ? (macroRes.value as { data: MacroState }).data : null;
      setMacro(macroData);

      const apiResults = [quoteRes, profileRes, metricsRes, ratiosRes, historyRes, incomeRes, balanceRes, cashRes, peersRes, targetsRes, estimatesRes, holdersRes, earningsRes, insiderRes, dcfRes];
      setFailedApis(apiResults.filter(r => r.status === "rejected").length);

      const quote   = quoteRes.status   === "fulfilled" ? (quoteRes.value as unknown[])?.[0]   as Record<string,unknown> ?? null : null;
      const profile = profileRes.status === "fulfilled" ? (profileRes.value as unknown[])?.[0] as Record<string,unknown> ?? null : null;
      const metrics = metricsRes.status === "fulfilled" ? (Array.isArray(metricsRes.value) ? metricsRes.value[0] : metricsRes.value) as Record<string,unknown> ?? null : null;
      const ratios  = ratiosRes.status  === "fulfilled" ? (Array.isArray(ratiosRes.value)  ? ratiosRes.value[0]  : ratiosRes.value)  as Record<string,unknown> ?? null : null;

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

      const stockData: StockData = {
        quote, profile, metrics, ratios,
        history:              historyRes.status  === "fulfilled" ? (historyRes.value  as Record<string,unknown>[]) ?? [] : [],
        income:               incomeRes.status   === "fulfilled" ? (incomeRes.value   as Record<string,unknown>[]) ?? [] : [],
        balanceSheet:         balanceRes.status  === "fulfilled" ? (balanceRes.value  as Record<string,unknown>[]) ?? [] : [],
        cashFlow:             cashRes.status     === "fulfilled" ? (cashRes.value     as Record<string,unknown>[]) ?? [] : [],
        peers:                peersRes.status    === "fulfilled" ? (peersRes.value    as string[]) ?? [] : [],
        priceTargets:         targetsRes.status  === "fulfilled" ? (targetsRes.value  as Record<string,unknown>[]) ?? [] : [],
        analystEstimates:     estimatesRes.status === "fulfilled" ? (estimatesRes.value as Record<string,unknown>[]) ?? [] : [],
        institutionalHolders: holdersRes.status  === "fulfilled" ? (holdersRes.value  as Record<string,unknown>[]) ?? [] : [],
        earningsSurprises:    earningsRes.status === "fulfilled" ? (earningsRes.value as Record<string,unknown>[]) ?? [] : [],
        insiderTrades:        insiderRes.status  === "fulfilled" ? ((insiderRes.value as { data?: unknown[] })?.data ?? []) as Record<string,unknown>[] : [],
        dcf:                  dcfRes.status === "fulfilled" ? (Array.isArray(dcfRes.value) ? dcfRes.value[0] : dcfRes.value) as Record<string,unknown> ?? null : null,
        spyHistory:           spyRes.status === "fulfilled" ? (spyRes.value as Record<string,unknown>[]) ?? [] : [],
        sectorEtfHistory,
        sectorEtfSymbol,
        congressTrades:       congressRes.status === "fulfilled" ? (congressRes.value as Record<string,unknown>[]) ?? [] : [],
        houseDisclosures:     houseRes.status    === "fulfilled" ? (houseRes.value    as Record<string,unknown>[]) ?? [] : [],
        annualIncome:         annualIncomeRes.status === "fulfilled" ? (annualIncomeRes.value as Record<string,unknown>[]) ?? [] : [],
        sharesFloat:          sharesFloatRes.status  === "fulfilled" ? (sharesFloatRes.value  as Record<string,unknown>[]) ?? [] : [],
      };

      setData(stockData);

      const macroTiltData = macroData ? getMacroTilt(macroData, sector) : { tilt: 0 };
      const calc = calcScores({
        pe:               metrics?.peRatioTTM as number ?? null,
        pb:               metrics?.priceToBookRatioTTM as number ?? null,
        evEbitda:         metrics?.enterpriseValueOverEBITDATTM as number ?? null,
        pfcf:             metrics?.priceToFreeCashFlowsRatioTTM as number ?? null,
        debtEquity:       ratios?.debtEquityRatioTTM as number ?? null,
        currentRatio:     ratios?.currentRatioTTM as number ?? null,
        interestCoverage: ratios?.interestCoverageTTM as number ?? null,
        netDebtEbitda:    metrics?.netDebtToEBITDATTM as number ?? null,
        roic:             metrics?.roicTTM != null ? (metrics.roicTTM as number) * 100 : null,
        roe:              metrics?.roeTTM  != null ? (metrics.roeTTM  as number) * 100 : null,
        grossMargin:      ratios?.grossProfitMarginTTM != null ? (ratios.grossProfitMarginTTM as number) * 100 : null,
        revenueGrowth:    ratios?.revenueGrowthTTM != null ? (ratios.revenueGrowthTTM as number) * 100 : null,
        epsGrowth:        ratios?.netIncomeGrowthTTM != null ? (ratios.netIncomeGrowthTTM as number) * 100 : null,
        marketCap:        quote?.marketCap as number ?? null,
        regime:           macroData?.regime_id ?? null,
      });
      setScores(calc);

      const rating = getRating(calc.total);
      const { data: saved } = await supabase.from("sl_analyses").upsert({
        ticker: ticker.toUpperCase(),
        analysis_date: new Date().toISOString().split("T")[0],
        score_total: calc.total,
        score_val: calc.value,
        score_hlth: calc.health,
        score_mom: calc.momentum,
        score_growth: calc.growth,
        rating: rating.label,
        macro_tilt: macroTiltData.tilt,
        sector,
      }, { onConflict: "ticker,analysis_date" }).select().single();

      if (saved) setSavedAnalysis(saved as StockAnalysis);

    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    }
    setLoading(false);
  }, [session, ticker]);

  useEffect(() => { if (session) analyze(); }, [session, analyze]);

  if (authLoading || !session) return null;

  const profile = data?.profile;
  const quote   = data?.quote;
  const sector  = (profile?.sector as string) ?? "";
  const macroTilt = macro ? getMacroTilt(macro, sector) : null;
  const icScore   = scores && macroTilt ? Math.max(0, Math.min(100, scores.total + macroTilt.tilt)) : null;
  const rating    = scores ? getRating(scores.total) : null;

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
    const csv = rows.map(([k, v]) => `"${k}","${v}"`).join("\n");
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
          {TABS.map(t => (
            <button key={t.id} className={`subtab ${activeTab === t.id ? "active" : ""}`} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "var(--sr-sp-6)", maxWidth: 1200, margin: "0 auto" }}>
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

        {activeTab === "overview"     && <StockOverview    data={data} macro={macro} scores={scores} icScore={icScore} rating={rating} macroTilt={macroTilt} loading={loading} ticker={ticker} savedAnalysis={savedAnalysis} />}
        {activeTab === "fundamentals" && <StockFundamentals data={data} loading={loading} ticker={ticker} />}
        {activeTab === "valuation"    && <StockValuation   data={data} macro={macro} loading={loading} ticker={ticker} />}
        {activeTab === "chart"        && <StockChart       data={data} loading={loading} ticker={ticker} />}
        {activeTab === "research"     && <StockResearch    data={data} scores={scores} loading={loading} ticker={ticker} macro={macro} macroTilt={macroTilt} />}
        {activeTab === "smartmoney"   && <StockSmartMoney  data={data} loading={loading} ticker={ticker} />}
        {activeTab === "screener"     && <StockScreener />}
        {activeTab === "compare"      && <StockCompare     ticker={ticker} />}
      </div>
    </div>
  );
}
