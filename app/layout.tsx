import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
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
          <Nav />
          <main style={{
            paddingTop: "var(--sr-nav-h)",
            minHeight: "100vh",
          }}>
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
