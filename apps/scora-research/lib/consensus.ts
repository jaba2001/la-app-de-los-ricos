// ─────────────────────────────────────────────────────────────────────────────
// CONSENSO TRIPLE (F3 · P0-3) — Scora frente a Wall Street frente al precio objetivo.
//
// Seeking Alpha enseña tres notas juntas (su quant, los analistas sell-side y sus
// colaboradores) y se queda ahí. Lo interesante no es que coincidan: es CUÁNDO NO
// coinciden, porque una discrepancia es información y un acuerdo no lo es tanto.
//
// Y una honestidad que SA no aplica: cuando Scora y la calle discrepan, no se insinúa que
// Scora tenga razón. La medición de esta misma investigación dice que el score no bate al
// índice seleccionando, así que la discrepancia se presenta como lo que es —dos opiniones
// distintas y los datos de cada una— y no como una oportunidad.
//
// Módulo PURO para los tests headless.
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsensusInputs {
  scoraTotal?: number | null;        // 0-100
  scoraRating?: string | null;       // STRONG BUY · BUY · CAUTION · AVOID
  /** Recuento de recomendaciones sell-side del último periodo. */
  street?: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
  priceTarget?: number | null;       // consenso de precio objetivo
  price?: number | null;             // precio actual
}

export type Stance = "bullish" | "neutral" | "bearish" | "unknown";

export interface ConsensusView {
  key: "scora" | "street" | "target";
  label: string;
  stance: Stance;
  detail: string;
  value: string;
}

export interface Consensus {
  views: ConsensusView[];
  agreement: "aligned" | "split" | "conflicted" | "insufficient";
  headline: string;
  note: string;
}

const stanceOf = (x: number, hi: number, lo: number): Stance => (x >= hi ? "bullish" : x <= lo ? "bearish" : "neutral");

export function buildConsensus(inp: ConsensusInputs): Consensus {
  const views: ConsensusView[] = [];

  if (inp.scoraTotal != null && isFinite(inp.scoraTotal)) {
    views.push({
      key: "scora", label: "Scora",
      stance: stanceOf(inp.scoraTotal, 60, 40),
      value: `${Math.round(inp.scoraTotal)}/100`,
      detail: inp.scoraRating ? `Rated ${inp.scoraRating} on fundamentals and trend.` : "Composite of value, health, momentum and growth.",
    });
  }

  const s = inp.street;
  if (s) {
    const total = s.strongBuy + s.buy + s.hold + s.sell + s.strongSell;
    if (total > 0) {
      // Media ponderada en escala 1-5, como la publican los propios brokers.
      const avg = (s.strongBuy * 5 + s.buy * 4 + s.hold * 3 + s.sell * 2 + s.strongSell * 1) / total;
      const pctBuy = ((s.strongBuy + s.buy) / total) * 100;
      views.push({
        key: "street", label: "Wall Street",
        stance: stanceOf(avg, 4, 2.8),
        value: `${avg.toFixed(1)}/5`,
        detail: `${pctBuy.toFixed(0)}% of ${total} analysts say buy.`,
      });
    }
  }

  if (inp.priceTarget != null && inp.price != null && inp.price > 0) {
    const upside = ((inp.priceTarget - inp.price) / inp.price) * 100;
    views.push({
      key: "target", label: "Price target",
      stance: stanceOf(upside, 12, -2),
      value: `${upside >= 0 ? "+" : ""}${upside.toFixed(0)}%`,
      detail: `Consensus target implies ${upside >= 0 ? "upside" : "downside"} from here.`,
    });
  }

  if (views.length < 2) {
    return { views, agreement: "insufficient", headline: "Not enough coverage to compare views.", note: "" };
  }

  const posturas = new Set(views.map((v) => v.stance));
  const alcistas = views.filter((v) => v.stance === "bullish").length;
  const bajistas = views.filter((v) => v.stance === "bearish").length;

  let agreement: Consensus["agreement"], headline: string, note: string;
  if (posturas.size === 1) {
    agreement = "aligned";
    headline = `All ${views.length} views point the same way.`;
    note = "Agreement is comfortable, but it is also what everyone else can see — it is rarely where an edge lives.";
  } else if (alcistas > 0 && bajistas > 0) {
    agreement = "conflicted";
    headline = "The views contradict each other.";
    note = "A disagreement is information: read what each one is looking at before deciding who is missing something. Scora being one of them does not make it the right one.";
  } else {
    agreement = "split";
    headline = "Partial agreement — one view is on the fence.";
    note = "Not a conflict, just less conviction than it looks from a single number.";
  }
  return { views, agreement, headline, note };
}
