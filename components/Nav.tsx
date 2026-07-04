"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { authedFetch } from "@/lib/proxy";

const MAIN_TABS = [
  { label: "Macro", href: "/macro" },
  { label: "Stocks", href: "/stock" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "Track Record", href: "/track-record" },
];

interface SearchResult { symbol: string; name: string; exchangeShortName: string; }

function tickerFlag(symbol: string, exchange: string): string {
  const dot = symbol.lastIndexOf(".");
  if (dot === -1) return ["NASDAQ", "NYSE", "AMEX"].includes(exchange) ? "🇺🇸" : "🌐";
  const sfx = symbol.slice(dot + 1).toUpperCase();
  const FLAGS: Record<string, string> = {
    PA: "🇫🇷", DE: "🇩🇪", L: "🇬🇧", MI: "🇮🇹", AS: "🇳🇱", SW: "🇨🇭",
    MC: "🇪🇸", ST: "🇸🇪", CO: "🇩🇰", OL: "🇳🇴", HE: "🇫🇮", LS: "🇵🇹",
    BR: "🇧🇪", VI: "🇦🇹", TO: "🇨🇦", AX: "🇦🇺", HK: "🇭🇰", T: "🇯🇵", SI: "🇸🇬",
  };
  return FLAGS[sfx] ?? "🌐";
}

export default function Nav() {
  const { session, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [suggIdx, setSuggIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await authedFetch<SearchResult[]>(
          `/api/fmp/search?query=${encodeURIComponent(query)}&limit=7`
        );
        setSuggestions(Array.isArray(results) ? results.slice(0, 7) : []);
      } catch {
        setSuggestions([]);
      }
    }, 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  function pick(sym: string) {
    setQuery("");
    setSuggestions([]);
    setSuggIdx(-1);
    router.push(`/stock/${sym}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSuggIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSuggIdx(i => Math.max(i - 1, -1)); }
    else if (e.key === "Escape") { setSuggestions([]); setSuggIdx(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (suggIdx >= 0 && suggestions[suggIdx]) { pick(suggestions[suggIdx].symbol); }
      else if (query.trim()) { pick(query.trim().toUpperCase()); }
    }
  }

  if (!session) return null;

  const activePath = MAIN_TABS.find(t => pathname.startsWith(t.href))?.href ?? "";

  return (
    <header style={{
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
            <path d="M2 12L6 7L9 10L13 4" stroke="#070E1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="13" cy="4" r="1.5" fill="#070E1A"/>
          </svg>
        </div>
        <div>
          <span style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--sr-text)" }}>
            Scora
          </span>
          <span style={{ fontSize: "var(--sr-t-base)", fontWeight: 400, color: "var(--sr-text-3)", marginLeft: 4 }}>
            Research
          </span>
        </div>
      </div>

      {/* Main tabs */}
      <nav style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {MAIN_TABS.map(tab => (
          <button
            key={tab.href}
            className={`tab-pill ${activePath === tab.href ? "active" : ""}`}
            onClick={() => router.push(tab.href)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Global ticker search */}
      <div style={{ position: "relative", flex: 1, maxWidth: 340 }}>
        <input
          placeholder="Search ticker or company…"
          value={query}
          onChange={e => { setQuery(e.target.value.toUpperCase()); setSuggIdx(-1); }}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => { setSuggestions([]); setSuggIdx(-1); }, 160)}
          autoComplete="off"
          maxLength={15}
          style={{
            width: "100%",
            background: "var(--sr-surface-2)",
            border: "1px solid var(--sr-border)",
            borderRadius: "var(--sr-radius)",
            color: "var(--sr-text)",
            fontSize: "var(--sr-t-sm)",
            padding: "6px 12px",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        {suggestions.length > 0 && (
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
            background: "var(--sr-surface-2)", border: "1px solid var(--sr-border-2)",
            borderRadius: "var(--sr-radius)", boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
            zIndex: 500, overflow: "hidden",
          }}>
            {suggestions.map((s, i) => (
              <div
                key={s.symbol}
                onMouseDown={() => pick(s.symbol)}
                onMouseEnter={() => setSuggIdx(i)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                  cursor: "pointer",
                  background: i === suggIdx ? "var(--sr-surface-2)" : "transparent",
                  borderBottom: i < suggestions.length - 1 ? "1px solid var(--sr-border)" : "none",
                }}
              >
                <span style={{ fontSize: 14, minWidth: 20, lineHeight: 1 }}>
                  {tickerFlag(s.symbol, s.exchangeShortName)}
                </span>
                <span style={{
                  fontWeight: 700, color: "var(--sr-amber)", fontSize: "var(--sr-t-xs)",
                  minWidth: 80, fontFamily: "var(--font-mono, ui-monospace, monospace)",
                }}>
                  {s.symbol}
                </span>
                <span style={{
                  color: "var(--sr-text-2)", fontSize: "var(--sr-t-xs)",
                  flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {s.name}
                </span>
                <span style={{ color: "var(--sr-text-3)", fontSize: "10px", flexShrink: 0 }}>
                  {s.exchangeShortName}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sign out */}
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, marginLeft: "auto" }}>
        <button
          className="btn-ghost"
          style={{ fontSize: "var(--sr-t-xs)", padding: "6px 12px" }}
          onClick={signOut}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
