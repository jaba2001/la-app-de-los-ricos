// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO EXPOSURE / CONCENTRATION — turns a set of open positions into sector,
// theme and single-name weights, a Herfindahl concentration index, and plain-language
// flags (over-weight sector, over-weight name, too few names). Pure & headless so the
// math is unit-tested; the component supplies sectors (from profiles) and themes.
// ─────────────────────────────────────────────────────────────────────────────

export interface Position { ticker: string; value: number; sector?: string | null; theme?: string | null; }
export interface Bucket { key: string; value: number; weight: number; count: number; }
export interface ExposureResult {
  totalValue: number;
  byPosition: Bucket[];   // each name's weight, desc
  bySector: Bucket[];     // sector weights, desc
  byTheme: Bucket[];      // theme weights, desc
  hhi: number;            // 0..1 Herfindahl (Σ name-weight²); 1 = single name, →0 = diffuse
  effectiveNames: number; // 1/HHI — effective number of independent bets
  topWeight: number;
  topName: string | null;
  flags: string[];
}

// Keyword → theme. First match wins; order matters (specific before generic).
const THEME_KEYWORDS: [string, RegExp][] = [
  ["AI",                   /\b(ai|artificial intelligence|llm|genai|machine learning)\b/i],
  ["Semiconductors",       /\b(semi|semiconductor|chip|gpu|foundry|fab)\b/i],
  ["Software / SaaS",      /\b(software|saas|cloud|cyber|platform)\b/i],
  ["Energy / Oil & Gas",   /\b(oil|gas|energy|lng|pipeline|drill|shale|utilit)\b/i],
  ["Gold / Metals",        /\b(gold|silver|copper|platinum|metal|mining|miner)\b/i],
  ["Crypto / Blockchain",  /\b(crypto|bitcoin|btc|ethereum|blockchain)\b/i],
  ["Financials",           /\b(bank|insur|fintech|broker|payment|financial)\b/i],
  ["Healthcare / Biotech", /\b(bio|pharma|health|medical|drug|therapeutic)\b/i],
  ["Industrials / Rail",   /\b(rail|industrial|defen[cs]e|aerospace|machinery|transport|shipping)\b/i],
  ["Consumer",             /\b(retail|consumer|brand|ecommerce|e-commerce|apparel)\b/i],
];

/** Classify a free-text thesis / tag into a coarse investment theme. */
export function detectTheme(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [label, re] of THEME_KEYWORDS) if (re.test(text)) return label;
  return null;
}

function bucketize(positions: Position[], total: number, keyOf: (p: Position) => string | null): Bucket[] {
  const map = new Map<string, { value: number; count: number }>();
  for (const p of positions) {
    const k = keyOf(p);
    if (!k) continue;
    const cur = map.get(k) ?? { value: 0, count: 0 };
    cur.value += p.value; cur.count += 1;
    map.set(k, cur);
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, value: v.value, count: v.count, weight: total > 0 ? v.value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

export function computeExposure(
  positions: Position[],
  opts?: { sectorCap?: number; nameCap?: number; minNames?: number }
): ExposureResult {
  const sectorCap = opts?.sectorCap ?? 0.40;
  const nameCap   = opts?.nameCap   ?? 0.25;
  const minNames  = opts?.minNames  ?? 5;

  const clean = positions.filter(p => isFinite(p.value) && p.value > 0);
  const totalValue = clean.reduce((s, p) => s + p.value, 0);

  const byPosition = clean
    .map(p => ({ key: p.ticker, value: p.value, count: 1, weight: totalValue > 0 ? p.value / totalValue : 0 }))
    .sort((a, b) => b.value - a.value);
  const bySector = bucketize(clean, totalValue, p => p.sector ?? null);
  const byTheme  = bucketize(clean, totalValue, p => p.theme ?? null);

  const hhi = byPosition.reduce((s, b) => s + b.weight * b.weight, 0);
  const effectiveNames = hhi > 0 ? 1 / hhi : 0;
  const topWeight = byPosition.length ? byPosition[0].weight : 0;
  const topName = byPosition.length ? byPosition[0].key : null;

  const flags: string[] = [];
  if (clean.length > 0 && clean.length < minNames)
    flags.push(`Only ${clean.length} position${clean.length === 1 ? "" : "s"} — a single name can swing the book. ${minNames}+ smooths it out.`);
  if (topName && topWeight > nameCap)
    flags.push(`${topName} is ${(topWeight * 100).toFixed(0)}% of the book (> ${(nameCap * 100).toFixed(0)}% guide). If it falls 20%, the portfolio takes ${(topWeight * 20).toFixed(1)}%.`);
  const topSector = bySector[0];
  if (topSector && topSector.weight > sectorCap)
    flags.push(`${topSector.key} is ${(topSector.weight * 100).toFixed(0)}% of the book (> ${(sectorCap * 100).toFixed(0)}% guide) — concentrated in one sector.`);
  const topThemeB = byTheme[0];
  if (topThemeB && topThemeB.weight > sectorCap)
    flags.push(`${(topThemeB.weight * 100).toFixed(0)}% sits in the ${topThemeB.key} theme — diversify across uncorrelated drivers.`);

  return { totalValue, byPosition, bySector, byTheme, hhi, effectiveNames, topWeight, topName, flags };
}
