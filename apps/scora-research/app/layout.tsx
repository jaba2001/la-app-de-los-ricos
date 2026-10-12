import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Newsreader } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { MacroProvider } from "@/lib/MacroContext";
import Nav from "@/components/Nav";
import SiteFooter from "@/components/SiteFooter";
import AnalyticsProvider from "@/components/AnalyticsProvider";
import ConsentBanner from "@/components/ConsentBanner";
import ScreenAssistant from "@/components/ScreenAssistant";
import { SITIO } from "@/lib/sitio";
import IdiomaProvider from "@/components/IdiomaProvider";
import { idiomaPeticion } from "@/lib/i18n/servidor";

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
  metadataBase: new URL(SITIO),
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
  themeColor: "#FAFAF7",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // El idioma sale de la cookie (o, la primera vez, del navegador): así el primer HTML ya va
  // en el idioma bueno. Leer la cookie hace dinámicas todas las páginas, que es lo que se quiere.
  const idioma = await idiomaPeticion();
  return (
    <html lang={idioma} className={`${hanken.variable} ${newsreader.variable}`}>
      <body>
        <IdiomaProvider idioma={idioma}>
        <AuthProvider>
          {/* Renders nothing — mounts PostHog and keeps identity in sync. Must be
              inside AuthProvider (reads the session). No-op without a PostHog key. */}
          <AnalyticsProvider />
          {/* Pide consentimiento antes de que PostHog arranque; sin respuesta no se inicia. */}
          <ConsentBanner />
          <MacroProvider>
            <Nav />
            <main style={{
              paddingTop: "var(--sr-nav-h)",
              minHeight: "100vh",
            }}>
              {children}
            </main>
            <SiteFooter />
            {/* «Ask about this page»: explica lo que hay en pantalla. En el layout para que la
                conversación sobreviva a la navegación entre páginas. */}
            <ScreenAssistant />
          </MacroProvider>
        </AuthProvider>
        </IdiomaProvider>
        {/* Delivery metrics (Core Web Vitals per route). Complements PostHog:
            PostHog measures behaviour, these measure how fast it arrives. */}
      </body>
    </html>
  );
}
