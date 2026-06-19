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

// ════════════════════════════════════════════════════════════════════════════
// RESEARCH INDICATORS (Tier 1, ADDITIVE) — derived from MASTER_PROMPT_MEJORAS_RESEARCH
//
// HARD RULE: nothing below changes the regime/composites. These are NEW nullable
// fields computed by their OWN windowed FRED fetches (independent of MACRO_SERIES,
// which still feeds the composites with exactly today's inputs). Every piece
// degrades with grace: a failed series → that field stays null and the existing
// macro_state upsert is NEVER affected (the caller wraps these in try/catch).
//
// Feature flags default OFF. With flags off, regime/cartera_quadrant are
// byte-identical to before (golden/baseline stay green; StockLens reads same).
// ════════════════════════════════════════════════════════════════════════════
const IC_FLAGS = {
  // A2 — recession gate: when ON, blocks a flip to "contraction" if claims aren't
  // rising and profits aren't falling. OFF (default) → regime untouched.
  A2_RECESSION_GATE: true,
};

// FRED fetch returning a short desc series [{date, v}, …]. Throws on HTTP/empty.
// `units` passes through to FRED (e.g. "pc1" for % YoY); default is the raw level.
async function fredSeries(id, fredKey, limit, units) {
  const u = units ? `&units=${units}` : "";
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${fredKey}&file_type=json&sort_order=desc&limit=${limit}${u}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED ${id} HTTP ${r.status}`);
  const d = await r.json();
  const obs = (d.observations || [])
    .filter((o) => o.value !== "." && o.value !== "")
    .map((o) => ({ date: o.date, v: parseFloat(o.value) }));
  if (!obs.length) throw new Error("no data");
  return obs;
}

// A1 (curve/steepener/term premium), A2 (claims/profits trends + gate), A3 (net
// liquidity direction + BoJ overlay), plus DGS2/10/30 levels (the latter is the
// `rf` the Reverse DCF prompt will read). All best-effort; per-series failures
// leave that field null. Verified FRED IDs (2026-06-16): THREEFYTP10 replaces
// the spec's non-existent ACMTP10; Cushing/SPR/CAPE deferred (not on FRED).
async function buildResearchIndicators(fredKey) {
  const out = {
    dgs2: null, dgs10: null, dgs30: null, term_premium_10y: null,
    curve_steepener: null, net_liquidity_t: null, net_liquidity_dir: null,
    boj_assets: null, claims_trend: null, profits_trend: null,
    recession_gate_active: null,
    // Tier 2 (A5/A6/A7)
    fed_room: null, core_pce_yoy: null, unrate: null,
    oil_shock: null, wti_level: null, wti_chg_1m: null,
    buffett_indicator: null, expected_return_10y: null,
    // Tier 3 (global liquidity overlay)
    ecb_assets: null, global_liquidity_dir: null,
  };
  const tryGet = async (id, limit, units) => {
    try { return await fredSeries(id, fredKey, limit, units); } catch { return null; }
  };
  const [dgs2, dgs10, dgs30, tp10, icsa, cp, walcl, rrp, tga, boj,
         pce, unrate, wti, ncbeil, gdpArr, ecb] = await Promise.all([
    tryGet("DGS2", 70), tryGet("DGS10", 5), tryGet("DGS30", 70),
    tryGet("THREEFYTP10", 5), tryGet("ICSA", 8), tryGet("CP", 5),
    tryGet("WALCL", 6), tryGet("RRPONTSYD", 6), tryGet("WTREGEN", 6), tryGet("JPNASSETS", 2),
    tryGet("PCEPILFE", 2, "pc1"), tryGet("UNRATE", 2), tryGet("DCOILWTICO", 30),
    tryGet("NCBEILQ027S", 2), tryGet("GDP", 2),
    tryGet("ECBASSETSW", 6),
  ]);

  out.dgs2 = dgs2?.[0]?.v ?? null;
  out.dgs10 = dgs10?.[0]?.v ?? null;
  out.dgs30 = dgs30?.[0]?.v ?? null;
  out.term_premium_10y = tp10?.[0]?.v ?? null;

  // A1 steepener over ~3m (≈63 trading days): classify by Δ(30Y−2Y) and which leg
  // drove it. bull = short rate falling (Fed/recession); bear = long rate rising
  // (fiscal/inflation premium). Today = bear, the "bad" one.
  if (dgs2 && dgs30 && dgs2.length > 1 && dgs30.length > 1) {
    const back = (arr) => arr[Math.min(arr.length - 1, 63)]?.v;
    const b2 = back(dgs2), b30 = back(dgs30);
    if (b2 != null && b30 != null) {
      const d2 = out.dgs2 - b2;          // Δ2Y
      const d30 = out.dgs30 - b30;       // Δ30Y
      const dSlope = (out.dgs30 - out.dgs2) - (b30 - b2); // Δ(30−2)
      if (dSlope > 0.05) out.curve_steepener = d2 < 0 && Math.abs(d2) >= Math.abs(d30) ? "bull" : "bear";
      else if (dSlope < -0.05) out.curve_steepener = "flattening";
      else out.curve_steepener = "flat";
    }
  }

  // A3 net liquidity = WALCL − TGA − RRP (in $T, same formula as the LCC netLiqT);
  // direction over ~4 weeks. This is the "master modulator" risk-on/off.
  const netLiqAt = (i) => {
    const w = walcl?.[i]?.v, t = tga?.[i]?.v, r = rrp?.[i]?.v;
    return w != null && t != null && r != null ? (w - t) / 1e6 - r / 1000 : null;
  };
  out.net_liquidity_t = netLiqAt(0);
  if (out.net_liquidity_t != null) {
    const nl4 = netLiqAt(Math.min((walcl?.length || 1) - 1, 4));
    if (nl4 != null) {
      const diff = out.net_liquidity_t - nl4;
      out.net_liquidity_dir = diff > 0.02 ? "expanding" : diff < -0.02 ? "contracting" : "flat";
    }
    out.net_liquidity_t = +out.net_liquidity_t.toFixed(3);
  }
  out.boj_assets = boj?.[0]?.v ?? null;

  // A2 gate inputs: claims 4wk avg vs prior 4wk; profits QoQ.
  if (icsa && icsa.length >= 8) {
    const avg = (a) => a.reduce((s, o) => s + o.v, 0) / a.length;
    const cur = avg(icsa.slice(0, 4)), prev = avg(icsa.slice(4, 8));
    out.claims_trend = cur > prev * 1.03 ? "rising" : cur < prev * 0.97 ? "falling" : "stable";
  }
  if (cp && cp.length >= 2) {
    out.profits_trend = cp[0].v > cp[1].v ? "rising" : cp[0].v < cp[1].v ? "falling" : "flat";
  }
  // Gate "would block contraction" when claims NOT rising AND profits NOT falling
  // (the spec's "don't flip to recession while claims low and profits at record").
  if (out.claims_trend != null && out.profits_trend != null) {
    out.recession_gate_active = out.claims_trend !== "rising" && out.profits_trend !== "falling";
  }

  // A5 Fed room ("good news is bad news"): high inflation + strong labor → Fed
  // has no room to ease. core PCE YoY vs 2% target + unemployment level.
  out.core_pce_yoy = pce?.[0]?.v != null ? +pce[0].v.toFixed(2) : null;
  out.unrate = unrate?.[0]?.v ?? null;
  if (out.core_pce_yoy != null && out.unrate != null) {
    if (out.core_pce_yoy > 2.5 && out.unrate < 4.5) out.fed_room = "constrained";
    else if (out.core_pce_yoy < 2.2 && out.unrate > 4.5) out.fed_room = "room";
    else out.fed_room = "neutral";
  }

  // A6 oil shock (WTI only — Cushing/SPR deferred, not on FRED): % move over ~1m.
  out.wti_level = wti?.[0]?.v ?? null;
  if (wti && wti.length > 21) {
    const now = wti[0].v, mAgo = wti[Math.min(wti.length - 1, 21)].v;
    if (mAgo) {
      out.wti_chg_1m = +(((now - mAgo) / mAgo) * 100).toFixed(1);
      out.oil_shock = out.wti_chg_1m >= 15;
    }
  }

  // A7 Buffett indicator → expected 10y real return. Numerator NCBEILQ027S
  // (corp. equities, $M) / GDP ($B), both → $T. High valuation → low forward
  // return (Bravos PE curve): ~6% at 100%, ~0% near 200%, negative above.
  const eq = ncbeil?.[0]?.v ?? null, gdp = gdpArr?.[0]?.v ?? null;
  if (eq != null && gdp != null && gdp > 0) {
    const ratio = (eq / 1e6) / (gdp / 1e3); // $T / $T
    out.buffett_indicator = +(ratio * 100).toFixed(1);
    out.expected_return_10y = +Math.max(-5, Math.min(12, 6 - 5 * (ratio - 1.0))).toFixed(1);
  }

  // Tier 3 — global liquidity overlay: vote of US net liquidity + ECB + BoJ
  // direction (direction only, so EUR/JPY/USD units are irrelevant). Softens or
  // reinforces the rates risk story (e.g. Nikkei ATH despite rate hikes = BoJ).
  out.ecb_assets = ecb?.[0]?.v ?? null;
  const dirOf = (arr, backIdx) => {
    if (!arr || arr.length < 2) return null;
    const now = arr[0].v, then = arr[Math.min(arr.length - 1, backIdx)].v;
    if (now == null || then == null || !then) return null;
    const pct = (now - then) / then;
    return pct > 0.002 ? 1 : pct < -0.002 ? -1 : 0;
  };
  const usDir = out.net_liquidity_dir === "expanding" ? 1 : out.net_liquidity_dir === "contracting" ? -1 : out.net_liquidity_dir === "flat" ? 0 : null;
  const votes = [usDir, dirOf(ecb, 4), dirOf(boj, 1)].filter((v) => v != null);
  if (votes.length) {
    const sum = votes.reduce((a, b) => a + b, 0);
    out.global_liquidity_dir = sum > 0 ? "expanding" : sum < 0 ? "contracting" : "mixed";
  }
  return out;
}

// A4 — private-credit proxy via a couple of cached ETF quotes (BIZD = BDC index,
// BKLN = leveraged loans). Finnhub only (FMP's /stable/quote rejects BIZD/BKLN
// under our plan — "Premium Query Parameter" — so the daily % change lives in
// Finnhub's `dp` field instead). No key or any failure → nulls. Refreshed in the
// cron, never per user (0 new user quota). Divergence (HY tight but proxy weak)
// is finalised in buildMacroState where HY OAS is available.
async function buildCreditProxy(finnhubKey) {
  if (!finnhubKey) return { credit_private_proxy: null, credit_divergence: null };
  const q = async (sym) => {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${finnhubKey}`);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  };
  const [bizd, bkln] = await Promise.all([q("BIZD"), q("BKLN")]);
  const ch = [bizd?.dp, bkln?.dp].filter((v) => typeof v === "number");
  const proxy = ch.length ? ch.reduce((s, v) => s + v, 0) / ch.length : null;
  return { credit_private_proxy: proxy != null ? +proxy.toFixed(3) : null, credit_divergence: null };
}

// A8 — positioning/sentiment (contrarian). Source: CNN Fear & Greed JSON, which
// bundles the CBOE put/call ratio + a composite retail sentiment gauge (the
// canonical contrarian read). Needs a browser-like UA (else HTTP 418). Cached in
// the cron; 0 user fetches. Fully graceful — any block/failure → all nulls.
// (AAII proper is omitted: no stable free feed; the F&G composite covers the
// same contrarian signal.)
async function buildSentiment() {
  const out = { put_call_ratio: null, fear_greed: null, fear_greed_rating: null, sentiment_signal: null };
  try {
    const r = await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.cnn.com/markets/fear-and-greed",
      },
    });
    if (!r.ok) return out;
    const d = await r.json();
    const fg = d?.fear_and_greed?.score;
    out.fear_greed = fg != null ? Math.round(fg) : null;
    out.fear_greed_rating = d?.fear_and_greed?.rating ?? null;
    const pc = (d?.put_call_options?.data || []).slice(-1)[0]?.y;
    out.put_call_ratio = pc != null ? +Number(pc).toFixed(3) : null;
    // Contrarian read: euphoria (>=75) → bearish; panic (<=25) → bullish.
    if (out.fear_greed != null) {
      out.sentiment_signal = out.fear_greed >= 75 ? "euforia" : out.fear_greed <= 25 ? "panico" : "neutral";
    }
  } catch { /* graceful: nulls */ }
  return out;
}

// ── Top-level: fetch FRED + compute the full macro_state row (sans ic_score) ─
// Returns { row, scores, regime, errors }. `row` matches the columns IC
// DataLayer writes (origin ≈ line 4707); ic_score is intentionally omitted
// (the web app's macro_state writer doesn't set it either). The research fields
// are additive (nullable) and fully isolated: any failure leaves them null and
// the regime upsert proceeds exactly as before.
async function buildMacroState(fredKey, opts = {}) {
  const { ds, errors } = await fetchMacroDataStore(fredKey);
  const scores = computeCompositeScores(ds, null);
  let reg = classifyRegime(scores.liquidityCycle, scores.recessionProbability, scores.creditStress);

  // Research indicators — isolated; never break the existing upsert.
  let research = {};
  try { research = await buildResearchIndicators(fredKey); }
  catch (e) { errors.push(`research: ${e.message}`); }
  let credit = { credit_private_proxy: null, credit_divergence: null };
  try { credit = await buildCreditProxy(opts.finnhubKey); }
  catch (e) { errors.push(`credit_proxy: ${e.message}`); }
  let sentiment = { put_call_ratio: null, fear_greed: null, fear_greed_rating: null, sentiment_signal: null };
  try { sentiment = await buildSentiment(); }
  catch (e) { errors.push(`sentiment: ${e.message}`); }

  // A4 divergence: public HY tight (<350 bps) but private proxy weak (<−0.5%).
  const hyOas = ds?.BAMLH0A0HYM2?.value ?? null;
  if (credit.credit_private_proxy != null && hyOas != null) {
    credit.credit_divergence = hyOas < 350 && credit.credit_private_proxy < -0.5;
  }

  // A2 recession gate — FLAG-GATED. OFF (default) → regime byte-identical. ON →
  // a "contraction" call is held to "neutral" while claims aren't rising and
  // profits aren't falling (avoids the curve-only false positive).
  if (IC_FLAGS.A2_RECESSION_GATE && reg && reg.id === "contraction" && research.recession_gate_active === true) {
    reg = { id: "neutral", label: "Transición", color: "#6B7280", emoji: "⚪" }; // hold contraction → Transición (NOT reflation; classifyRegime(56,56,56) would hit the reflation branch)
  }

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
    // ── Research (Tier 1, additive, nullable) ──
    dgs2: research.dgs2 ?? null,
    dgs10: research.dgs10 ?? null,
    dgs30: research.dgs30 ?? null,
    term_premium_10y: research.term_premium_10y ?? null,
    curve_steepener: research.curve_steepener ?? null,
    net_liquidity_t: research.net_liquidity_t ?? null,
    net_liquidity_dir: research.net_liquidity_dir ?? null,
    boj_assets: research.boj_assets ?? null,
    claims_trend: research.claims_trend ?? null,
    profits_trend: research.profits_trend ?? null,
    recession_gate_active: research.recession_gate_active ?? null,
    credit_private_proxy: credit.credit_private_proxy ?? null,
    credit_divergence: credit.credit_divergence ?? null,
    // ── Research Tier 2 (A5/A6/A7, additive, nullable) ──
    fed_room: research.fed_room ?? null,
    core_pce_yoy: research.core_pce_yoy ?? null,
    unrate: research.unrate ?? null,
    oil_shock: research.oil_shock ?? null,
    wti_level: research.wti_level ?? null,
    wti_chg_1m: research.wti_chg_1m ?? null,
    buffett_indicator: research.buffett_indicator ?? null,
    expected_return_10y: research.expected_return_10y ?? null,
    // ── Research Tier 3 (global liquidity overlay) ──
    ecb_assets: research.ecb_assets ?? null,
    global_liquidity_dir: research.global_liquidity_dir ?? null,
    // ── A8 sentiment (contrarian) ──
    put_call_ratio: sentiment.put_call_ratio ?? null,
    fear_greed: sentiment.fear_greed ?? null,
    fear_greed_rating: sentiment.fear_greed_rating ?? null,
    sentiment_signal: sentiment.sentiment_signal ?? null,
  };
  return { row, scores, regime: reg, errors, seriesFetched: Object.keys(ds).length };
}

export {
  classifyRegime,
  computeCompositeScores,
  fetchMacroDataStore,
  buildMacroState,
  buildResearchIndicators,
  buildCreditProxy,
  buildSentiment,
  MACRO_SERIES,
  FRED_UNIT_CONVERSIONS,
  IC_FLAGS,
};
