// lib/macro.js — Macro regime engine (server-side, FRED-only).
//
// PORTED VERBATIM from the IC DataLayer web app so the daily cron writes the
// SAME `macro_state` row the app writes on "↻ Cargar Datos". This keeps the
// StockLens Macro Tilt fresh even when nobody opens IC DataLayer.
//
//   Origin: IC-DataLayer/IC_DataLayer_v2.js
//     · FRED_UNIT_CONVERSIONS      (≈ line 565)
//     · classifyRegime(lcc,rpc,csc)(≈ line 1731)
//     · computeCompositeScores(...) (≈ line 1782)
//   KEEP IN SYNC with that file if the formulas change there.
//
// Intentional, documented differences vs origin (none affect macro_state):
//   · meltupScore tail dropped — it needs paid ETF prices (`fp`) and is NOT a
//     macro_state column.
//   · polyData passed as null — Polymarket isn't fetched server-side; RPC falls
//     back to its FRED-only blend EXACTLY as the origin does when polyData==null.
//   · MOVE / TTF not fetched (non-FRED / paid) — origin already has graceful
//     fallbacks (MOVE is an override only; TTF defaults to 25).

// ── FRED DIRECT API UNIT CONVERSIONS (origin ≈ line 565) ─────────────────────
// FRED returns some series in different units than the model uses.
const FRED_UNIT_CONVERSIONS = {
  // ICE BofA OAS spreads: FRED returns decimal % (3.17) → model uses bps (317)
  BAMLH0A0HYM2: 100,
  BAMLH0A1HYBB: 100,
  BAMLH0A3HYC: 100,
  BAMLC0A4CBBB: 100,
  BAMLC0A0CM: 100,
  EXHOSLUSM495S: 1, // FRED already K SAAR
  ICSA: 0.001, // FRED returns actual count (207000) → model uses K (207)
};

// Series the 5 composites actually read, with their transform.
// transform "yoy" → FRED units=pc1 (% YoY); everything else is a raw level.
// (Only CSUSHPINSA is yoy among the series the regime needs — matches FRED_SERIES
// in the origin; M2SL is "level" there, so its changePct is a MoM %, as the
// origin computes it.)
const MACRO_SERIES = [
  // LCC
  "WALCL", "WTREGEN", "RRPONTSYD", "WRESBAL", "SOFR", "DFEDTARL", "M2SL",
  // CSC
  "BAMLH0A0HYM2", "BAMLH0A1HYBB", "BAMLH0A3HYC", "BAMLC0A4CBBB", "STLFSI4", "DRTSCILM",
  // RPC
  "SAHMREALTIME", "T10Y2Y", "T10Y3M", "ICSA", "UMCSENT", "HOUST",
  // GRC
  //   NOTE: GOLDAMGBD228NLBM is intentionally NOT fetched — that FRED series is
  //   discontinued (HTTP 400) and the web app sources gold from the paid GLD ETF
  //   quote, which is out of scope for this FRED-only cron. With gold absent,
  //   the GRC gold component falls back to 30 exactly as the origin does on a
  //   gold-fetch failure. Gold does not affect the regime (only LCC/RPC/CSC do).
  "DCOILWTICO", "DCOILBRENTEU", "OVXCLS", "VIXCLS", "DEXJPUS", "DTWEXBGS",
  // HSC
  "EXHOSLUSM495S", "MORTGAGE30US", "PERMIT", "CSUSHPINSA",
];

const YOY_SERIES = new Set(["CSUSHPINSA"]); // → units=pc1 (matches origin FRED_SERIES)

// ── classifyRegime (origin ≈ line 1731) — VERBATIM ──────────────────────────
function classifyRegime(lcc, rpc, csc) {
  const highLCC = lcc > 55;
  const highRPC = rpc > 55;
  const highCSC = csc > 55;
  if (highLCC && !highRPC)
    return { id: "expansion", label: "Expansión", color: "#10B981", emoji: "🟢" };
  if (highLCC && highRPC)
    return { id: "reflation", label: "Reflación", color: "#3B82F6", emoji: "🔵" };
  if (!highLCC && highRPC)
    return { id: "stagflation", label: "Estanflación", color: "var(--color-regime-restrictivo)", emoji: "🟠" };
  if (!highLCC && !highRPC && !highCSC)
    return { id: "contraction", label: "Contracción", color: "var(--accent-danger)", emoji: "🔴" };
  return { id: "neutral", label: "Transición", color: "#6B7280", emoji: "⚪" };
}

// regime.id → cartera_quadrant (origin ≈ line 4706 _qmap)
const QMAP = {
  expansion: "crecimiento",
  reflation: "inflacion",
  stagflation: "estanflacion",
  contraction: "defensivo",
  neutral: "defensivo",
};

// ── computeCompositeScores (origin ≈ line 1782) — VERBATIM minus meltup/fp ───
function computeCompositeScores(ds, polyData = null) {
  const safe = (key) => ds?.[key]?.value ?? null;
  // ─── LCC — Liquidity Cycle Composite ───────────────────────────────────────
  const lccCalc = (() => {
    const walclM = safe("WALCL"); // millions
    const wtregenM = safe("WTREGEN"); // millions
    const rrpB = safe("RRPONTSYD"); // billions
    let netLiq_score = 50;
    if (walclM != null && wtregenM != null && rrpB != null) {
      const netLiqT = (walclM - wtregenM) / 1e6 - rrpB / 1000;
      netLiq_score = Math.max(0, Math.min(100,
        netLiqT < 3 ? 0
        : netLiqT < 4 ? (netLiqT - 3) * 30
        : netLiqT < 5 ? 30 + (netLiqT - 4) * 30
        : 60 + ((netLiqT - 5) / 1.5) * 40));
    }
    const wresbalB = safe("WRESBAL");
    const wresbalT = wresbalB != null ? wresbalB / 1e6 : null; // millions → T
    let wresbal_score = 50;
    if (wresbalT != null) {
      wresbal_score = Math.max(0, Math.min(100,
        wresbalT >= 4 ? 100
        : wresbalT >= 3 ? 50 + (wresbalT - 3) * 50
        : wresbalT >= 2 ? (wresbalT - 2) * 50
        : 0));
    }
    const sofr = safe("SOFR");
    const fedfunds = safe("DFEDTARL");
    let sofr_score = 50;
    if (sofr != null && fedfunds != null) {
      const spread = sofr - fedfunds;
      sofr_score = Math.max(0, Math.min(100,
        spread < -0.5 ? 100
        : spread < 0 ? 50 + (Math.abs(spread) / 0.5) * 50
        : spread < 0.25 ? 50 - (spread / 0.25) * 50
        : 0));
    } else if (sofr != null) {
      sofr_score = Math.max(0, Math.min(100, ((5.5 - sofr) / 5.5) * 100));
    }
    const m2chg = ds?.["M2SL"]?.changePct ?? null;
    let m2_score = 50;
    if (m2chg != null) {
      m2_score = Math.max(0, Math.min(100,
        m2chg < -2 ? 0
        : m2chg < 0 ? ((m2chg + 2) / 2) * 30
        : m2chg < 4 ? 30 + (m2chg / 4) * 40
        : m2chg < 8 ? 70 + ((m2chg - 4) / 4) * 20
        : Math.max(50, 90 - (m2chg - 8) * 5)));
    }
    const tgaDelta = ds?.["WTREGEN"]?.change ?? null; // change in millions
    let tga_score = 50;
    if (tgaDelta != null) {
      const tgaDeltaB = tgaDelta / 1000; // millions → billions
      tga_score = Math.max(0, Math.min(100,
        tgaDeltaB < -50 ? 80
        : tgaDeltaB < 0 ? 50 + (Math.abs(tgaDeltaB) / 50) * 30
        : tgaDeltaB < 50 ? 50 - (tgaDeltaB / 50) * 30
        : 20));
    }
    const lcc =
      netLiq_score * 0.35 + wresbal_score * 0.2 + sofr_score * 0.2 + m2_score * 0.15 + tga_score * 0.1;
    return Math.max(0, Math.min(100, lcc));
  })();
  // ─── CSC — Credit Stress Composite ─────────────────────────────────────────
  const cscCalc = (() => {
    const hyOas = safe("BAMLH0A0HYM2");
    let hyOas_score = 50;
    if (hyOas != null) {
      hyOas_score = Math.max(0, Math.min(100,
        hyOas < 250 ? 0
        : hyOas < 350 ? ((hyOas - 250) / 100) * 30
        : hyOas < 500 ? 30 + ((hyOas - 350) / 150) * 45
        : 75 + Math.min(25, ((hyOas - 500) / 200) * 25)));
    }
    const hyOasChg = ds?.["BAMLH0A0HYM2"]?.change ?? null;
    let hyRoC_score = 20;
    if (hyOasChg != null) {
      hyRoC_score = Math.max(0, Math.min(100,
        hyOasChg < 0 ? 0
        : hyOasChg < 50 ? (hyOasChg / 50) * 30
        : hyOasChg < 150 ? 30 + ((hyOasChg - 50) / 100) * 50
        : 80 + Math.min(20, ((hyOasChg - 150) / 50) * 20)));
    }
    const moveVal = safe("MOVE");
    if (moveVal != null) {
      const moveStress = moveVal > 150 ? 80 : moveVal > 120 ? 55 : moveVal > 90 ? 35 : 15;
      if (moveStress > hyRoC_score) hyRoC_score = (hyRoC_score + moveStress) / 2;
    }
    const bbOas = safe("BAMLH0A1HYBB");
    const cccOas = safe("BAMLH0A3HYC");
    let bbCcc_score = 40;
    if (bbOas != null && cccOas != null) {
      const diff = cccOas - bbOas;
      bbCcc_score = Math.max(0, Math.min(100,
        diff < 100 ? 10
        : diff < 200 ? 10 + ((diff - 100) / 100) * 30
        : diff < 350 ? 40 + ((diff - 200) / 150) * 40
        : 80 + Math.min(20, ((diff - 350) / 100) * 20)));
    }
    const bbbSpread = safe("BAMLC0A4CBBB");
    let bbb_score = 30;
    if (bbbSpread != null) {
      bbb_score = Math.max(0, Math.min(100,
        bbbSpread < 100 ? 0
        : bbbSpread < 150 ? ((bbbSpread - 100) / 50) * 30
        : bbbSpread < 250 ? 30 + ((bbbSpread - 150) / 100) * 50
        : 80 + Math.min(20, ((bbbSpread - 250) / 50) * 20)));
    }
    const stlfsi = safe("STLFSI4");
    let stlfsi_score = 30;
    if (stlfsi != null) {
      stlfsi_score = Math.max(0, Math.min(100,
        stlfsi < -1 ? 0
        : stlfsi < 0 ? (stlfsi + 1) * 25
        : stlfsi < 0.5 ? 25 + (stlfsi / 0.5) * 40
        : stlfsi < 1 ? 65 + ((stlfsi - 0.5) / 0.5) * 25
        : 90 + Math.min(10, (stlfsi - 1) * 10)));
    }
    const drtscilm = safe("DRTSCILM");
    let candi_score = 30;
    if (drtscilm != null) {
      candi_score = Math.max(0, Math.min(100,
        drtscilm < -20 ? 0
        : drtscilm < 0 ? ((drtscilm + 20) / 20) * 20
        : drtscilm < 25 ? 20 + (drtscilm / 25) * 30
        : drtscilm < 50 ? 50 + ((drtscilm - 25) / 25) * 30
        : 80 + Math.min(20, ((drtscilm - 50) / 20) * 20)));
    }
    const csc =
      hyOas_score * 0.3 + hyRoC_score * 0.2 + bbCcc_score * 0.15 + bbb_score * 0.15 + stlfsi_score * 0.1 + candi_score * 0.1;
    return Math.max(0, Math.min(100, csc));
  })();
  // ─── RPC — Recession Probability Composite ─────────────────────────────────
  const rpcCalc = (() => {
    const sahm = safe("SAHMREALTIME");
    let sahm_score = 20;
    if (sahm != null) {
      sahm_score = Math.max(0, Math.min(100,
        sahm < 0.1 ? 5
        : sahm < 0.3 ? 5 + ((sahm - 0.1) / 0.2) * 25
        : sahm < 0.5 ? 30 + ((sahm - 0.3) / 0.2) * 40
        : 70 + Math.min(30, ((sahm - 0.5) / 0.5) * 30)));
    }
    const t10y2y = safe("T10Y2Y");
    let curve2y_score = 30;
    if (t10y2y != null) {
      curve2y_score = Math.max(0, Math.min(100,
        t10y2y > 1.5 ? 5
        : t10y2y > 0.5 ? 5 + (1.5 - t10y2y) * 20
        : t10y2y > 0 ? 25 + ((0.5 - t10y2y) / 0.5) * 25
        : t10y2y > -0.5 ? 50 + (Math.abs(t10y2y) / 0.5) * 25
        : 75 + Math.min(25, ((Math.abs(t10y2y) - 0.5) / 0.5) * 25)));
    }
    const t10y3m = safe("T10Y3M");
    let curve3m_score = 30;
    if (t10y3m != null) {
      curve3m_score = Math.max(0, Math.min(100,
        t10y3m > 1 ? 5
        : t10y3m > 0 ? 5 + (1 - t10y3m) * 30
        : t10y3m > -0.5 ? 35 + (Math.abs(t10y3m) / 0.5) * 35
        : 70 + Math.min(30, (Math.abs(t10y3m) - 0.5) * 30)));
    }
    const icsa = safe("ICSA");
    const icsaK = icsa != null && icsa > 1000 ? icsa / 1000 : icsa;
    let icsa_score = 20;
    if (icsaK != null) {
      icsa_score = Math.max(0, Math.min(100,
        icsaK < 200 ? 5
        : icsaK < 250 ? 5 + ((icsaK - 200) / 50) * 20
        : icsaK < 300 ? 25 + ((icsaK - 250) / 50) * 30
        : icsaK < 350 ? 55 + ((icsaK - 300) / 50) * 25
        : 80 + Math.min(20, ((icsaK - 350) / 100) * 20)));
    }
    const umcsent = safe("UMCSENT");
    let umcsent_score = 30;
    if (umcsent != null) {
      umcsent_score = Math.max(0, Math.min(100,
        umcsent > 90 ? 5
        : umcsent > 80 ? 5 + (90 - umcsent) * 2
        : umcsent > 65 ? 25 + ((80 - umcsent) / 15) * 40
        : umcsent > 50 ? 65 + ((65 - umcsent) / 15) * 25
        : 90 + Math.min(10, ((50 - umcsent) / 10) * 10)));
    }
    const houst = safe("HOUST");
    let houst_score = 25;
    if (houst != null) {
      houst_score = Math.max(0, Math.min(100,
        houst > 1600 ? 5
        : houst > 1400 ? 5 + ((1600 - houst) / 200) * 20
        : houst > 1200 ? 25 + ((1400 - houst) / 200) * 30
        : houst > 1000 ? 55 + ((1200 - houst) / 200) * 25
        : 80 + Math.min(20, ((1000 - houst) / 200) * 20)));
    }
    const rpc_fred =
      sahm_score * 0.25 + curve2y_score * 0.2 + curve3m_score * 0.15 + icsa_score * 0.15 + umcsent_score * 0.15 + houst_score * 0.1;
    // Blend with Polymarket prediction market (15% weight) if available.
    const rpc =
      polyData?.recessProb != null ? rpc_fred * 0.85 + polyData.recessProb * 100 * 0.15 : rpc_fred;
    return Math.max(5, Math.min(98, rpc));
  })();
  // ─── GRC — Geopolitical Risk Composite ─────────────────────────────────────
  const grcCalc = (() => {
    const wti = safe("DCOILWTICO");
    let wti_score = 30;
    if (wti != null) {
      wti_score = Math.max(0, Math.min(100,
        wti < 60 ? 10
        : wti < 80 ? 10 + ((wti - 60) / 20) * 20
        : wti < 100 ? 30 + ((wti - 80) / 20) * 40
        : 70 + Math.min(30, ((wti - 100) / 30) * 30)));
    }
    const brent = safe("DCOILBRENTEU");
    let brentWti_score = 20;
    if (brent != null && wti != null) {
      const spread = brent - wti;
      brentWti_score = Math.max(0, Math.min(100,
        spread < 1 ? 10
        : spread < 3 ? 10 + ((spread - 1) / 2) * 20
        : spread < 8 ? 30 + ((spread - 3) / 5) * 50
        : 80 + Math.min(20, ((spread - 8) / 4) * 20)));
    }
    const ovx = safe("OVXCLS") ?? (safe("VIXCLS") != null ? safe("VIXCLS") * 1.6 : null);
    let ovx_score = 30;
    if (ovx != null) {
      ovx_score = Math.max(0, Math.min(100,
        ovx < 20 ? 10
        : ovx < 30 ? 10 + ((ovx - 20) / 10) * 30
        : ovx < 45 ? 40 + ((ovx - 30) / 15) * 40
        : 80 + Math.min(20, ((ovx - 45) / 15) * 20)));
    }
    const gold = safe("GOLDAMGBD228NLBM");
    const goldChg = ds?.["GOLDAMGBD228NLBM"]?.changePct ?? null;
    let gold_score = 30;
    if (gold != null) {
      const momentum = goldChg != null ? Math.max(0, goldChg * 10) : 0;
      gold_score = Math.max(0, Math.min(100,
        gold < 2000 ? 10
        : gold < 2500 ? 10 + ((gold - 2000) / 500) * 20
        : gold < 3000 ? 30 + ((gold - 2500) / 500) * 25
        : 55 + Math.min(25, ((gold - 3000) / 1000) * 25) + momentum));
    }
    const usdjpy = safe("DEXJPUS");
    let usdjpy_score = 20;
    if (usdjpy != null) {
      usdjpy_score = Math.max(0, Math.min(100,
        usdjpy > 155 ? 30
        : usdjpy > 145 ? 20
        : usdjpy > 140 ? 20 + (145 - usdjpy) * 6
        : usdjpy > 135 ? 50 + (140 - usdjpy) * 6
        : 80 + Math.min(20, (135 - usdjpy) * 4)));
    }
    const dxy = safe("DTWEXBGS");
    let dxy_score = 20;
    if (dxy != null) {
      dxy_score = Math.max(0, Math.min(100,
        dxy < 96 ? 10
        : dxy < 100 ? 10 + ((dxy - 96) / 4) * 10
        : dxy < 106 ? 20 + ((dxy - 100) / 6) * 25
        : dxy < 110 ? 45 + ((dxy - 106) / 4) * 35
        : 80 + Math.min(20, ((dxy - 110) / 5) * 20)));
    }
    const ttf = safe("TTF");
    let ttf_score = 25; // fallback when not available
    if (ttf != null) {
      ttf_score = Math.max(0, Math.min(100,
        ttf < 20 ? 10
        : ttf < 35 ? 10 + ((ttf - 20) / 15) * 20
        : ttf < 60 ? 30 + ((ttf - 35) / 25) * 40
        : ttf < 100 ? 70 + ((ttf - 60) / 40) * 20
        : 90 + Math.min(10, ((ttf - 100) / 50) * 10)));
    }
    const grc =
      wti_score * 0.23 + brentWti_score * 0.14 + ovx_score * 0.19 + gold_score * 0.19 + usdjpy_score * 0.1 + dxy_score * 0.1 + ttf_score * 0.05;
    return Math.max(0, Math.min(100, grc));
  })();
  // ─── HSC — Housing Stress Composite ────────────────────────────────────────
  const hscCalc = (() => {
    const existSales = safe("EXHOSLUSM495S");
    let existSales_score = 30;
    if (existSales != null) {
      existSales_score = Math.max(0, Math.min(100,
        existSales > 5500 ? 5
        : existSales > 5000 ? 5 + ((5500 - existSales) / 500) * 25
        : existSales > 4000 ? 30 + ((5000 - existSales) / 1000) * 30
        : existSales > 3500 ? 60 + ((4000 - existSales) / 500) * 20
        : 80 + Math.min(20, ((3500 - existSales) / 500) * 20)));
    }
    const mortgage = safe("MORTGAGE30US");
    let mortgage_score = 30;
    if (mortgage != null) {
      mortgage_score = Math.max(0, Math.min(100,
        mortgage < 4 ? 5
        : mortgage < 6 ? 5 + ((mortgage - 4) / 2) * 25
        : mortgage < 7 ? 30 + (mortgage - 6) * 35
        : mortgage < 7.5 ? 65 + ((mortgage - 7) / 0.5) * 20
        : 85 + Math.min(15, ((mortgage - 7.5) / 0.5) * 15)));
    }
    const houst = safe("HOUST");
    let houst_score = 25;
    if (houst != null) {
      houst_score = Math.max(0, Math.min(100,
        houst > 1600 ? 5
        : houst > 1400 ? 5 + ((1600 - houst) / 200) * 25
        : houst > 1200 ? 30 + ((1400 - houst) / 200) * 30
        : houst > 1000 ? 60 + ((1200 - houst) / 200) * 25
        : 85 + Math.min(15, ((1000 - houst) / 200) * 15)));
    }
    const permit = safe("PERMIT");
    let permit_score = 25;
    if (permit != null) {
      permit_score = Math.max(0, Math.min(100,
        permit > 1700 ? 5
        : permit > 1500 ? 5 + ((1700 - permit) / 200) * 25
        : permit > 1300 ? 30 + ((1500 - permit) / 200) * 30
        : permit > 1100 ? 60 + ((1300 - permit) / 200) * 25
        : 85 + Math.min(15, ((1100 - permit) / 200) * 15)));
    }
    const caseShiller = safe("CSUSHPINSA");
    let cs_score = 25;
    if (caseShiller != null) {
      cs_score = Math.max(0, Math.min(100,
        caseShiller > 5 ? 10
        : caseShiller > 2 ? 10 + ((5 - caseShiller) / 3) * 25
        : caseShiller > 0 ? 35 + ((2 - caseShiller) / 2) * 30
        : caseShiller > -3 ? 65 + (Math.abs(caseShiller) / 3) * 25
        : 90 + Math.min(10, ((Math.abs(caseShiller) - 3) / 3) * 10)));
    }
    const hsc =
      existSales_score * 0.3 + mortgage_score * 0.25 + houst_score * 0.2 + permit_score * 0.15 + cs_score * 0.1;
    return Math.max(0, Math.min(100, hsc));
  })();
  return {
    liquidityCycle: parseFloat(lccCalc.toFixed(1)),
    creditStress: parseFloat(cscCalc.toFixed(1)),
    recessionProbability: parseFloat(rpcCalc.toFixed(1)),
    geopoliticalRisk: parseFloat(grcCalc.toFixed(1)),
    housingStress: parseFloat(hscCalc.toFixed(1)),
  };
}

// ── FRED fetch → ds builder (mirrors origin fetchFred, ≈ line 5109) ──────────
// Builds { [seriesId]: { value, prevValue, change, changePct, date, status } }
// using the SAME limit=5 / sort_order=desc / units=pc1(for yoy) / unitFactor
// derivation the web app uses, so the composites get identical inputs.
async function fetchFredObs(seriesId, fredKey) {
  const u = YOY_SERIES.has(seriesId) ? "&units=pc1" : "";
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${fredKey}&file_type=json&sort_order=desc&limit=5${u}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED ${seriesId} HTTP ${r.status}`);
  const d = await r.json();
  const obs = (d.observations || []).filter((o) => o.value !== "." && o.value !== "");
  if (!obs.length) throw new Error("No data");
  const factor = FRED_UNIT_CONVERSIONS[seriesId] ?? 1;
  const v = parseFloat(obs[0].value) * factor;
  const pv = obs[1] ? parseFloat(obs[1].value) * factor : null;
  return {
    value: v,
    prevValue: pv,
    change: pv != null ? v - pv : null,
    changePct: pv ? ((v - pv) / pv) * 100 : null,
    date: obs[0].date,
    status: "LIVE",
  };
}

// Fetches all macro series and returns { ds, errors }. A failed series is
// simply absent from ds (the composites treat a missing key as null, exactly
// like the web app on a fetch error).
async function fetchMacroDataStore(fredKey) {
  const ds = {};
  const errors = [];
  const results = await Promise.all(
    MACRO_SERIES.map(async (id) => {
      try {
        return [id, await fetchFredObs(id, fredKey)];
      } catch (e) {
        errors.push(`${id}: ${e.message}`);
        return [id, null];
      }
    })
  );
  for (const [id, entry] of results) if (entry) ds[id] = entry;
  return { ds, errors };
}

// ── Top-level: fetch FRED + compute the full macro_state row (sans ic_score) ─
// Returns { row, scores, regime, errors }. `row` matches the columns IC
// DataLayer writes (origin ≈ line 4707); ic_score is intentionally omitted
// (the web app's macro_state writer doesn't set it either).
async function buildMacroState(fredKey) {
  const { ds, errors } = await fetchMacroDataStore(fredKey);
  const scores = computeCompositeScores(ds, null);
  const reg = classifyRegime(scores.liquidityCycle, scores.recessionProbability, scores.creditStress);
  const row = {
    id: 1,
    snapshot_date: new Date().toISOString().slice(0, 10),
    credit_stress: scores.creditStress,
    liquidity_cycle: scores.liquidityCycle,
    recession_prob: scores.recessionProbability,
    geopolitical_risk: scores.geopoliticalRisk,
    housing_stress: scores.housingStress,
    regime_id: reg ? reg.id : null,
    regime_label: reg ? reg.label : null,
    cartera_quadrant: (reg && QMAP[reg.id]) || "defensivo",
    updated_at: new Date().toISOString(),
  };
  return { row, scores, regime: reg, errors, seriesFetched: Object.keys(ds).length };
}

export {
  classifyRegime,
  computeCompositeScores,
  fetchMacroDataStore,
  buildMacroState,
  MACRO_SERIES,
  FRED_UNIT_CONVERSIONS,
};
