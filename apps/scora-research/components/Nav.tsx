"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import QuotaPill from "@/components/ui/QuotaPill";
import TickerSearch from "@/components/TickerSearch";
import SelectorIdioma from "@/components/SelectorIdioma";
import { t } from "@/lib/i18n/cliente";

const MAIN_TABS = [
  // Primero: es la pieza diaria, la razón de volver cada día (y es pública).
  { label: "Daily", href: "/daily" },
  { label: "Macro", href: "/macro" },
  { label: "Discovery", href: "/discovery" },
  { label: "Momentum", href: "/momentum" },
  { label: "Stocks", href: "/stock" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "Journal", href: "/journal" },
  { label: "Track Record", href: "/track-record" },
  { label: "Evidence", href: "/evidence" },
  { label: "Audit", href: "/audit" },
];

export default function Nav() {
  const { session, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Menú plegable para pantallas estrechas: las 10 pestañas, el buscador y la cuenta no caben
  // por debajo de ~1100 px, y la barra empujaba la página entera hacia los lados en el móvil.
  const [menuAbierto, setMenuAbierto] = useState(false);
  useEffect(() => { setMenuAbierto(false); }, [pathname]);

  if (!session) return null;

  const activePath = MAIN_TABS.find(t => pathname.startsWith(t.href))?.href ?? "";

  return (
    <header className="nav-header" style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      height: "var(--sr-nav-h)",
      background: "color-mix(in srgb, var(--sr-bg) 92%, transparent)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      borderBottom: "1px solid var(--sr-border)",
      display: "flex",
      alignItems: "center",
      padding: "0 var(--sr-sp-6)",
      gap: "var(--sr-sp-5)",
    }}>
      {/* Logo */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flexShrink: 0 }}
        onClick={() => router.push("/macro")}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: "var(--sr-amber)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "var(--sr-shadow-amber)",
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 12L6 7L9 10L13 4" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="13" cy="4" r="1.5" fill="#FFFFFF"/>
          </svg>
        </div>
        <div>
          <span style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--sr-text)" }}>
            Scora
          </span>
          <span className="nav-logo-sub" style={{ fontSize: "var(--sr-t-base)", fontWeight: 400, color: "var(--sr-text-3)", marginLeft: 4 }}>
            Research
          </span>
        </div>
      </div>

      {/* Main tabs */}
      <nav className="nav-desktop" style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {MAIN_TABS.map(tab => (
          <button
            key={tab.href}
            className={`tab-pill ${activePath === tab.href ? "active" : ""}`}
            onClick={() => router.push(tab.href)}
          >
            {t(tab.label)}
          </button>
        ))}
      </nav>

      {/* Global ticker search */}
      <TickerSearch
        placeholder={t("Search ticker or company…")}
        style={{ flex: 1, minWidth: 0, maxWidth: 340 }}
      />

      {/* Cuota de IA + sign out */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginLeft: "auto" }}>
        <QuotaPill />
        <span className="nav-desktop"><SelectorIdioma compacto /></span>
        <button
          className="btn-ghost nav-desktop"
          style={{ fontSize: "var(--sr-t-xs)", padding: "6px 12px" }}
          onClick={() => router.push("/account")}
        >
          {t("Account")}
        </button>
        <button
          className="btn-ghost nav-desktop"
          style={{ fontSize: "var(--sr-t-xs)", padding: "6px 12px" }}
          onClick={signOut}
        >
          {t("Sign out")}
        </button>
        <button
          className="btn-ghost nav-menu-btn"
          aria-label={menuAbierto ? t("Close menu") : t("Open menu")}
          aria-expanded={menuAbierto}
          style={{ fontSize: "var(--sr-t-base)", padding: "6px 10px", lineHeight: 1 }}
          onClick={() => setMenuAbierto(v => !v)}
        >
          {menuAbierto ? "✕" : "☰"}
        </button>
      </div>

      {menuAbierto && (
        <div className="nav-menu-panel" style={{
          position: "absolute", top: "100%", left: 0, right: 0,
          background: "var(--sr-bg)", borderBottom: "1px solid var(--sr-border)",
          boxShadow: "0 12px 28px rgba(0,0,0,0.12)", padding: "var(--sr-sp-2) var(--sr-sp-4) var(--sr-sp-4)",
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6,
          maxHeight: "calc(100vh - var(--sr-nav-h))", overflowY: "auto",
        }}>
          {MAIN_TABS.map(tab => (
            <button
              key={tab.href}
              className={`tab-pill ${activePath === tab.href ? "active" : ""}`}
              style={{ justifyContent: "flex-start", textAlign: "left" }}
              onClick={() => router.push(tab.href)}
            >
              {t(tab.label)}
            </button>
          ))}
          <button className="btn-ghost" style={{ fontSize: "var(--sr-t-sm)", textAlign: "left" }} onClick={() => router.push("/account")}>{t("Account")}</button>
          <button className="btn-ghost" style={{ fontSize: "var(--sr-t-sm)", textAlign: "left" }} onClick={signOut}>{t("Sign out")}</button>
          <div style={{ gridColumn: "1 / -1", paddingTop: 4 }}><SelectorIdioma /></div>
        </div>
      )}
    </header>
  );
}
