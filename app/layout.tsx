import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { MacroProvider } from "@/lib/MacroContext";
import Nav from "@/components/Nav";
import AnalyticsProvider from "@/components/AnalyticsProvider";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://scora-research.vercel.app"),
  title: { default: "Scora Research — the top-down system that corrects itself", template: "%s · Scora Research" },
  description: "Regime-driven multi-asset allocation, validated out-of-sample, plus an AI layer that can't invent a number — enforced in code. Free. Risk, managed and auditable.",
  keywords: ["macro regime", "asset allocation", "risk parity", "stock research", "grounded AI", "backtest", "top-down"],
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Scora Research" },
  openGraph: {
    title: "Scora Research — the top-down system that corrects itself",
    description: "Regime-driven allocation validated out-of-sample + AI that can't hallucinate figures. Free, auditable, honest.",
    url: "/", siteName: "Scora Research", type: "website",
  },
  twitter: { card: "summary_large_image", title: "Scora Research", description: "Validated regime allocation + auditable AI. Free." },
};

export const viewport: Viewport = {
  themeColor: "#070E1A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={hanken.variable}>
      <body>
        <AuthProvider>
          {/* Renders nothing — mounts PostHog and keeps identity in sync. Must be
              inside AuthProvider (reads the session). No-op without a PostHog key. */}
          <AnalyticsProvider />
          <MacroProvider>
            <Nav />
            <main style={{
              paddingTop: "var(--sr-nav-h)",
              minHeight: "100vh",
            }}>
              {children}
            </main>
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
          </MacroProvider>
        </AuthProvider>
        {/* Delivery metrics (Core Web Vitals per route). Complements PostHog:
            PostHog measures behaviour, these measure how fast it arrives. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
