import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { MacroProvider } from "@/lib/MacroContext";
import Nav from "@/components/Nav";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Scora Research",
  description: "Macro + Stock research platform",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Scora Research" },
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
      </body>
    </html>
  );
}
