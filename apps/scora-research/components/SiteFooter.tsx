"use client";
import { usePathname } from "next/navigation";

// The app-wide disclaimer footer. The public landing ("/") renders its own footer
// with the same disclaimer in the light landing-v2 system, so it is skipped there.
export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <footer style={{
      padding: "var(--sr-sp-4) var(--sr-sp-6)",
      borderTop: "1px solid var(--sr-border)",
      fontSize: "10px",
      lineHeight: 1.6,
      color: "var(--sr-text-3)",
      textAlign: "center",
      maxWidth: 1200,
      margin: "0 auto",
    }}>
      Scora Research is an educational tool for informational purposes only and is <strong>not investment advice</strong>.
      Scores, valuations, backtests and AI commentary are estimates that may be wrong or out of date; verify independently before making any decision.
      Past performance does not predict future results. Data from FRED, Finnhub, FMP, SEC EDGAR and other public sources.
    </footer>
  );
}
