// Geopolitical context layer (P2-14). A static knowledge base of the major power blocs (from the
// "Geopolítica - La Cumbre" material) + a live read that turns macro_state's geopolitical_risk /
// oil-shock / commodity fields into an asset tilt. Additive context for the macro brief — it does
// NOT feed the validated allocator weights.
import type { MacroState } from "./types";

export interface RegionBrief { region: string; role: string; watch: string; assets: string }

export const GEO_REGIONS: RegionBrief[] = [
  { region: "United States", role: "Incumbent hegemon; the dollar as both weapon and safe haven.", watch: "Elections, debt ceiling, Fed policy, semiconductor controls.", assets: "USD, Treasuries, mega-cap tech." },
  { region: "China", role: "Structural challenger; manufacturing base and rare-earth chokehold.", watch: "Taiwan, local-government & property debt, tech decoupling.", assets: "Industrial metals, semis, European luxury." },
  { region: "Russia / Post-Soviet", role: "Resource power — gas, oil, grain.", watch: "Ukraine, energy flows to Europe, sanctions & re-routing.", assets: "European gas, oil, wheat, gold." },
  { region: "Middle East", role: "Oil swing producer (OPEC+) and key shipping lanes.", watch: "Strait of Hormuz, Israel–Iran, crude risk premia.", assets: "Brent, defense, defensives." },
  { region: "Europe / EU", role: "Trade bloc dependent on imported energy.", watch: "Energy security, fiscal fragmentation, industrial competitiveness.", assets: "EUR, autos, industrials." },
  { region: "Latin America", role: "Commodity supplier — copper, lithium, grains, oil.", watch: "Commodity cycle, politics, nearshoring flows.", assets: "Copper, lithium, agriculture, energy." },
  { region: "India / South Asia", role: "Rising demographic and manufacturing alternative to China.", watch: "Supply-chain diversification, energy imports, regional tensions.", assets: "EM equity, domestic demand plays." },
];

// ── Commodity / energy chokepoints & dependencies (Fase 6, from "Geopolítica" Bloque 4) ──
// Static knowledge base: the physical chokepoints and supply concentrations that turn a regional
// shock into a global price move. Narrative context for the geopolitics read — not a live signal.
export interface Chokepoint { name: string; commodity: string; risk: string; beneficiaries: string; }
export const CHOKEPOINTS: Chokepoint[] = [
  { name: "Strait of Hormuz", commodity: "Crude oil & LNG (~20% of global oil)", risk: "Iran–Gulf tension can close or threaten transit → crude spike.", beneficiaries: "Energy, defense, US shale, tankers." },
  { name: "Bab-el-Mandeb / Suez", commodity: "Oil & container trade Europe↔Asia", risk: "Red Sea attacks reroute ships around Africa → freight + delivery costs up.", beneficiaries: "Shipping rates, oil, inventories-heavy retailers hurt." },
  { name: "Strait of Malacca", commodity: "Asia-bound oil & trade (~25% of traded goods)", risk: "China's 'Malacca dilemma' — a blockade chokes Chinese energy imports.", beneficiaries: "Overland pipelines, alt routes, defense." },
  { name: "Taiwan Strait", commodity: "Advanced semiconductors (TSMC ~90% leading-edge)", risk: "A Taiwan crisis would halt the world's leading-edge chip supply.", beneficiaries: "Onshore fabs (US/Japan), chip-equipment, defense." },
  { name: "Russian pipeline gas", commodity: "Natural gas to Europe", risk: "Cut-offs / sanctions force LNG imports → European gas & power prices.", beneficiaries: "US LNG, Qatar, European utilities hurt, coal." },
  { name: "China rare-earth refining", commodity: "Rare earths & processing (~70-90%)", risk: "Export controls choke magnets for EVs, wind, defense.", beneficiaries: "Ex-China miners/refiners, recyclers, defense primes." },
  { name: "Panama Canal", commodity: "US grain, LNG, container trade", risk: "Drought cuts transits → longer routes, higher costs.", beneficiaries: "Shipping, US Gulf exporters affected." },
  { name: "LatAm copper & lithium", commodity: "Copper (Chile/Peru), lithium (Chile/Argentina)", risk: "Politics/resource-nationalism disrupts the energy-transition metals.", beneficiaries: "Diversified miners, recyclers, substitutes." },
];

export interface GeoRead { level: "Low" | "Elevated" | "High"; color: string; drivers: string[]; tilt: string }

/** Turn the macro composites into a plain-language geopolitical read + asset tilt. */
export function geopoliticalRead(macro: MacroState | null): GeoRead | null {
  if (!macro) return null;
  const gr = macro.geopolitical_risk;
  const level: GeoRead["level"] = gr == null ? "Elevated" : gr >= 66 ? "High" : gr >= 33 ? "Elevated" : "Low";
  const color = level === "High" ? "var(--sr-neg)" : level === "Elevated" ? "var(--sr-warn)" : "var(--sr-pos)";

  const drivers: string[] = [];
  if (gr != null) drivers.push(`Geopolitical-risk composite ${gr.toFixed(0)}/100.`);
  if (macro.oil_shock && macro.oil_shock !== "none") drivers.push(`Oil-shock signal: ${macro.oil_shock}.`);
  if (macro.brent != null) drivers.push(`Brent ~$${macro.brent.toFixed(0)}${macro.wti_chg_1m != null ? ` (WTI ${macro.wti_chg_1m >= 0 ? "+" : ""}${macro.wti_chg_1m.toFixed(1)}% 1m)` : ""}.`);
  if (macro.dxy != null) drivers.push(`Dollar (DXY) ${macro.dxy.toFixed(1)} — a stronger dollar tightens global conditions.`);
  if (drivers.length === 0) drivers.push("Limited geopolitical inputs in the current snapshot.");

  const tilt = level === "High"
    ? "Risk-off geopolitics favors energy, defense, gold and the dollar; it pressures import-dependent Europe and long-duration risk."
    : level === "Elevated"
      ? "Keep some hedges (energy/gold) but the backdrop isn't crisis-level; stay led by the domestic macro regime."
      : "Benign geopolitics — let the domestic liquidity/credit regime drive positioning, not headlines.";

  return { level, color, drivers, tilt };
}
