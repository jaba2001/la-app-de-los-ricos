import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Newsreader } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { MacroProvider } from "@/lib/MacroContext";
import Nav from "@/components/Nav";
import SiteFooter from "@/components/SiteFooter";
import AnalyticsProvider from "@/components/AnalyticsProvider";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

// Editorial serif for the public landing's display type (landing-v2.css).
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
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
    <html lang="en" className={`${hanken.variable} ${newsreader.variable}`}>
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
            <SiteFooter />
          </MacroProvider>
        </AuthProvider>
        {/* Delivery metrics (Core Web Vitals per route). Complements PostHog:
            PostHog measures behaviour, these measure how fast it arrives. */}
      </body>
    </html>
  );
}
