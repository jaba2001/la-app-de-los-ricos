// ─────────────────────────────────────────────────────────────────────────────
// DAILY/WEEKLY MACRO BRIEF — turns a macro_state row into a spoken script.
//
// WHY THIS IS A TEMPLATE AND NOT AN LLM CALL.
// Scora's core promise is that its AI layer cannot invent a figure, and that promise is
// enforced by the grounding gate in scora-research/lib/grounding.ts. This cron runs in
// ic-proxy — a different repository — so putting an LLM here would have meant either
// shipping a second copy of that gate (the duplication we just spent a day removing from
// the filing parser) or emitting Scora-branded numbers that never passed it.
//
// A macro read-out is pure template material: it states measured values and the regime
// they imply. Writing it deterministically makes "no invented numbers" STRUCTURAL rather
// than checked — there is no model in the loop to invent one. It also costs nothing and
// produces a consistent voice day after day.
//
// If interpretive commentary is ever wanted here, the honest way to add it is to move the
// grounding gate into a package both repos import, not to copy it.
//
// Pure: no I/O, no imports. Unit-tested by scripts/brief.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

/** Regime ids → the words we say. macro_state.regime_label is Spanish; the app is English. */
const REGIME_WORDS = {
  expansion: "expansion",
  slowdown: "slowdown",
  contraction: "contraction",
  recovery: "recovery",
  stagflation: "stagflation",
  goldilocks: "goldilocks",
};

const n = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const one = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** Numbers read aloud: "4.69 percent", not "4.69%". TTS engines mangle bare symbols. */
const pct = (v, dp = 2) => (v == null ? null : `${v.toFixed(dp)} percent`);

/** Join sentences into a paragraph, dropping the ones whose data was missing. */
const para = (...sentences) => sentences.filter(Boolean).join(" ");

/**
 * Build the spoken script for one macro snapshot.
 * @param {object} m  a macro_state row
 * @param {object} [opts]
 * @param {"daily"|"weekly"} [opts.cadence="weekly"]
 * @returns {{ script: string, chars: number, asOf: string|null, sections: string[] }}
 */
export function buildBriefScript(m, opts = {}) {
  if (!m) throw new Error("buildBriefScript: no macro_state row");
  const cadence = opts.cadence === "daily" ? "daily" : "weekly";

  const riskOn = one(n(m.risk_on));
  const lcc = one(n(m.risk_on_lcc));
  const rpc = one(n(m.risk_on_rpc));
  const csc = one(n(m.risk_on_csc));
  const dgs10 = n(m.dgs10), dgs2 = n(m.dgs2), spread = n(m.t10y2y);
  const vix = n(m.vix), hy = n(m.hy_oas), breadth = one(n(m.breadth_200dma));
  const recess = one(n(m.recession_prob));
  const regime = REGIME_WORDS[String(m.regime_id || "").toLowerCase()] || null;
  const confirmed = String(m.regime_confirmation || "").toLowerCase() === "confirmed";

  const sections = [];
  const out = [];

  // ── Opening: what this is, and the headline read ──────────────────────────
  const opening = para(
    `This is your ${cadence} Scora macro brief.`,
    regime
      ? `The regime reads ${regime}${confirmed ? ", and it is confirmed" : ", though it is not yet confirmed"}.`
      : null,
    riskOn != null
      ? `The risk gauge sits at ${riskOn} out of one hundred, which is ${riskOn >= 50 ? "risk-on" : "risk-off"} territory.`
      : null,
  );
  if (opening) { out.push(opening); sections.push("opening"); }

  // ── What is driving the gauge ─────────────────────────────────────────────
  // Named in plain words: the three sub-scores mean nothing to a listener as acronyms.
  const drivers = para(
    lcc != null ? `Liquidity is at ${lcc},` : null,
    rpc != null ? `recession risk at ${rpc},` : null,
    csc != null ? `and financial stress at ${csc}.` : null,
  );
  if (drivers) {
    const lead = "Underneath that gauge, three things move it.";
    // Say which one is pulling hardest — the useful part, and derivable without a model.
    let dominant = null;
    if (lcc != null && rpc != null && csc != null) {
      const pulls = [
        { name: "expanding liquidity", up: lcc >= 60 },
        { name: "recession risk", up: rpc >= 60 },
        { name: "financial stress", up: csc >= 60 },
      ].filter((p) => p.up).map((p) => p.name);
      dominant = pulls.length
        ? `The standout right now is ${pulls.join(" and ")}.`
        : `None of the three is at an extreme.`;
    }
    out.push(para(lead, drivers, dominant));
    sections.push("drivers");
  }

  // ── Rates and the curve ───────────────────────────────────────────────────
  const rates = para(
    dgs10 != null ? `The ten-year Treasury yields ${pct(dgs10)}.` : null,
    dgs2 != null && dgs10 != null
      ? `The two-year is at ${pct(dgs2)}, so the curve is ${spread != null && spread < 0 ? "inverted" : "positively sloped"}${spread != null ? ` by ${Math.abs(Math.round(spread * 100))} basis points` : ""}.`
      : null,
  );
  if (rates) { out.push(rates); sections.push("rates"); }

  // ── Volatility, credit, breadth ───────────────────────────────────────────
  // The adjective has to follow the number. "Volatility is subdued at 15" is true; the
  // same sentence with the VIX at 35 is a false statement in Scora's own voice, which is
  // exactly what this product cannot afford to emit — so the word is derived, not fixed.
  const vixWord = vix == null ? null : vix < 16 ? "subdued" : vix < 22 ? "unremarkable" : vix < 30 ? "elevated" : "stressed";
  const market = para(
    vix != null ? `Volatility is ${vixWord} at ${vix.toFixed(1)} on the VIX.` : null,
    hy != null ? `High-yield spreads are ${Math.round(hy)} basis points.` : null,
    breadth != null ? `Breadth is ${breadth} percent of the index above its two-hundred-day average.` : null,
  );
  if (market) { out.push(market); sections.push("market"); }

  // ── What it implies for positioning ───────────────────────────────────────
  // Mirrors the GROWTH profile rule in lib/allocation.ts: full equity above 50, a 60
  // percent floor plus ballast below. Stated as what the allocator does, not as advice.
  if (riskOn != null) {
    out.push(para(
      riskOn >= 50
        ? `With the gauge above fifty, Scora's validated allocator holds a full equity position.`
        : `With the gauge below fifty, Scora's validated allocator drops to its sixty percent equity floor and adds defensive ballast.`,
      recess != null ? `Its recession probability read is ${recess} percent.` : null,
    ));
    sections.push("positioning");
  }

  // ── Close ─────────────────────────────────────────────────────────────────
  out.push(
    "These are measured figures from Scora's snapshot, not investment advice. " +
    "Past performance does not predict future results.",
  );
  sections.push("disclaimer");

  const script = out.join("\n\n");
  return { script, chars: script.length, asOf: m.snapshot_date ?? null, sections };
}

/**
 * Characters this cadence will spend per month, for staying inside a TTS free tier.
 * A 30-day month of daily briefs is roughly 4.3x a weekly one — the difference between
 * fitting a free plan and not.
 */
export function monthlyChars(chars, cadence) {
  return Math.round(chars * (cadence === "daily" ? 30 : 4.345));
}
