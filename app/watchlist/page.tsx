"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { authedFetch } from "@/lib/proxy";

interface WatchlistItem { id: number; ticker: string; added_at: string; }
interface Quote { symbol: string; price: number; changesPercentage: number; pe: number | null; marketCap: number | null; }

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return `${n.toFixed(1)}`;
}

function Sk({ h = 14, w = "100%" }: { h?: number; w?: string }) {
  return <div style={{ width: w, height: h, borderRadius: 4, background: "var(--sr-surface-3)", animation: "pulse 1.5s ease-in-out infinite" }} />;
}

export default function WatchlistPage() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loadingList, setLoadingList] = useState(true);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !session) router.replace("/login");
  }, [session, authLoading, router]);

  const loadItems = useCallback(async () => {
    if (!session) return;
    setLoadingList(true);
    const { data, error } = await supabase
      .from("sl_watchlist")
      .select("id,ticker,added_at")
      .eq("user_id", session.user.id)
      .order("added_at", { ascending: false });
    if (error) setError(error.message);
    else setItems(data ?? []);
    setLoadingList(false);
  }, [session]);

  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    if (items.length === 0) { setQuotes({}); return; }
    setLoadingQuotes(true);
    Promise.allSettled(
      items.map(item =>
        authedFetch<Quote[]>(`/api/fmp/stable/quote/${item.ticker}`)
          .then(r => ({ ticker: item.ticker, data: Array.isArray(r) ? r[0] : null }))
      )
    ).then(results => {
      const map: Record<string, Quote> = {};
      results.forEach(r => {
        if (r.status === "fulfilled" && r.value.data) map[r.value.ticker] = r.value.data;
      });
      setQuotes(map);
      setLoadingQuotes(false);
    }).catch(() => setLoadingQuotes(false));
  }, [items]);

  async function addTicker() {
    const t = newTicker.trim().toUpperCase();
    if (!t || !session) return;
    setAdding(true);
    setError("");
    const { error } = await supabase.from("sl_watchlist").insert({ user_id: session.user.id, ticker: t });
    if (error) setError(error.message);
    else { setNewTicker(""); await loadItems(); }
    setAdding(false);
  }

  async function removeTicker(id: number) {
    const { error } = await supabase.from("sl_watchlist").delete().eq("id", id);
    if (error) setError(error.message);
    else setItems(prev => prev.filter(i => i.id !== id));
  }

  if (authLoading || !session) return null;

  return (
    <div style={{ padding: "var(--sr-sp-5)", maxWidth: 960, margin: "0 auto" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "var(--sr-sp-6)", flexWrap: "wrap", gap: "var(--sr-sp-3)",
      }}>
        <h1 style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, letterSpacing: "-0.02em" }}>Watchlist</h1>
        <div style={{ display: "flex", gap: "var(--sr-sp-2)" }}>
          <input
            type="text"
            value={newTicker}
            onChange={e => setNewTicker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && addTicker()}
            placeholder="AAPL, MSFT…"
            style={{
              padding: "var(--sr-sp-2) var(--sr-sp-3)",
              background: "var(--sr-surface)",
              border: "1px solid var(--sr-border)",
              borderRadius: "var(--sr-radius)",
              color: "var(--sr-text)",
              fontSize: "var(--sr-t-sm)",
              outline: "none",
              width: 150,
            }}
            onFocus={e => (e.target.style.borderColor = "var(--sr-amber)")}
            onBlur={e => (e.target.style.borderColor = "var(--sr-border)")}
          />
          <button
            onClick={addTicker}
            disabled={adding || !newTicker.trim()}
            style={{
              padding: "var(--sr-sp-2) var(--sr-sp-4)",
              background: "var(--sr-amber)",
              color: "var(--sr-text-inv)",
              border: "none",
              borderRadius: "var(--sr-radius)",
              fontSize: "var(--sr-t-sm)",
              fontWeight: 700,
              cursor: adding ? "not-allowed" : "pointer",
              opacity: adding ? 0.7 : 1,
            }}
          >
            {adding ? "…" : "Agregar"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: "var(--sr-sp-3) var(--sr-sp-4)", borderRadius: "var(--sr-radius)",
          background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)",
          color: "var(--sr-neg)", fontSize: "var(--sr-t-sm)", marginBottom: "var(--sr-sp-4)",
        }}>
          {error}
        </div>
      )}

      {loadingList ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
          {[1, 2, 3].map(i => <Sk key={i} h={56} />)}
        </div>
      ) : items.length === 0 ? (
        <div style={{
          padding: "var(--sr-sp-12)", textAlign: "center",
          background: "var(--sr-surface)", border: "1px solid var(--sr-border)",
          borderRadius: "var(--sr-radius-lg)",
        }}>
          <p style={{ fontSize: "var(--sr-t-base)", color: "var(--sr-text-2)", marginBottom: "var(--sr-sp-2)" }}>
            Tu watchlist está vacía
          </p>
          <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)" }}>
            Agrega tickers arriba o usa el ★ en la página de análisis de cualquier stock.
          </p>
        </div>
      ) : (
        <div style={{ background: "var(--sr-surface)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius-lg)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--sr-t-sm)" }}>
            <thead>
              <tr style={{ background: "var(--sr-surface-2)" }}>
                {["Ticker", "Precio", "Cambio %", "P/E", "Cap. Mercado", "Agregado", ""].map(h => (
                  <th key={h} style={{
                    padding: "var(--sr-sp-2) var(--sr-sp-3)",
                    textAlign: "left",
                    color: "var(--sr-text-3)",
                    fontWeight: 600,
                    fontSize: "var(--sr-t-xs)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const q = quotes[item.ticker];
                const pct = q?.changesPercentage ?? 0;
                const priceColor = pct > 0 ? "var(--sr-pos)" : pct < 0 ? "var(--sr-neg)" : "var(--sr-text)";
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid var(--sr-border)" }}>
                    <td style={{ padding: "var(--sr-sp-3)" }}>
                      <Link href={`/stock/${item.ticker}`} style={{
                        fontWeight: 700, color: "var(--sr-amber)",
                        textDecoration: "none", fontSize: "var(--sr-t-sm)",
                      }} className="num">
                        {item.ticker}
                      </Link>
                    </td>
                    <td style={{ padding: "var(--sr-sp-3)" }}>
                      {loadingQuotes ? <Sk w="60px" /> : (
                        <span className="num" style={{ fontWeight: 600 }}>
                          {q?.price != null ? `$${q.price.toFixed(2)}` : "—"}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "var(--sr-sp-3)" }}>
                      {loadingQuotes ? <Sk w="50px" /> : (
                        <span className="num" style={{ fontWeight: 600, color: priceColor }}>
                          {pct !== 0 ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "var(--sr-sp-3)", color: "var(--sr-text-2)" }}>
                      {loadingQuotes ? <Sk w="40px" /> : (
                        <span className="num">{q?.pe != null ? q.pe.toFixed(1) : "—"}</span>
                      )}
                    </td>
                    <td style={{ padding: "var(--sr-sp-3)", color: "var(--sr-text-2)" }}>
                      {loadingQuotes ? <Sk w="50px" /> : (
                        <span className="num">{fmt(q?.marketCap)}</span>
                      )}
                    </td>
                    <td style={{ padding: "var(--sr-sp-3)", color: "var(--sr-text-3)", fontSize: "var(--sr-t-xs)" }}>
                      {new Date(item.added_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                    </td>
                    <td style={{ padding: "var(--sr-sp-3)" }}>
                      <button
                        onClick={() => removeTicker(item.id)}
                        style={{
                          background: "none", border: "none",
                          color: "var(--sr-text-3)", cursor: "pointer",
                          fontSize: "var(--sr-t-base)", padding: "2px 8px",
                          borderRadius: "var(--sr-radius-sm)",
                        }}
                        title="Eliminar de watchlist"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
