"use client";
// Buscador de valores: sugerencias mientras se escribe, por ticker o por nombre y con erratas
// («aple», «nvidea»). Elegir una lleva a /stock/[ticker]. Lo usan la barra (Nav) y la portada
// de /stock; la búsqueda la hace el servidor (/api/search → lib/server/busqueda.js).
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { authedFetch } from "@/lib/proxy";
import { t } from "@/lib/i18n/cliente";

export interface TickerResult { symbol: string; name: string; exchange: string | null; type: "stock" | "etf"; }

const BANDERAS: Record<string, string> = {
  PA: "🇫🇷", DE: "🇩🇪", L: "🇬🇧", MI: "🇮🇹", AS: "🇳🇱", SW: "🇨🇭",
  MC: "🇪🇸", ST: "🇸🇪", CO: "🇩🇰", OL: "🇳🇴", HE: "🇫🇮", LS: "🇵🇹",
  BR: "🇧🇪", VI: "🇦🇹", TO: "🇨🇦", AX: "🇦🇺", HK: "🇭🇰", T: "🇯🇵", SI: "🇸🇬",
};

// Sin sufijo es EE. UU.: el servidor solo devuelve acciones y ETFs, y fuera de EE. UU. todos
// los tickers llevan el de su bolsa (.MC, .PA…).
export function tickerFlag(symbol: string): string {
  const punto = symbol.lastIndexOf(".");
  return punto === -1 ? "🇺🇸" : BANDERAS[symbol.slice(punto + 1).toUpperCase()] ?? "🌐";
}

// Lo que se puede mandar tal cual a /stock/ si no hay sugerencias (un ticker recién listado).
const PARECE_TICKER = /^[A-Za-z0-9.\-]{1,15}$/;
const ESPERA_MS = 180;

const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pone en negrita la parte del texto que coincide con lo escrito (sin mirar tildes ni mayúsculas). */
function Resaltado({ texto, consulta, color }: { texto: string; consulta: string; color: string }) {
  const q = plano(consulta.trim());
  // Carácter a carácter para que los índices sigan valiendo sobre el texto original.
  const i = q ? Array.from(texto, (c) => plano(c)[0] ?? c).join("").indexOf(q) : -1;
  if (i < 0 || texto.length !== Array.from(texto).length) return <>{texto}</>;
  return (
    <>
      {texto.slice(0, i)}
      <mark style={{ background: "transparent", color, fontWeight: 700 }}>{texto.slice(i, i + q.length)}</mark>
      {texto.slice(i + q.length)}
    </>
  );
}

interface Props {
  placeholder: string;
  /** "nav": compacto, para la barra. "hero": grande, con botón. */
  variant?: "nav" | "hero";
  /** Texto del botón de enviar; sin él no hay botón (Enter basta). */
  submitLabel?: string;
  autoFocus?: boolean;
  limit?: number;
  style?: CSSProperties;
}

export default function TickerSearch({ placeholder, variant = "nav", submitLabel, autoFocus, limit = 8, style }: Props) {
  const router = useRouter();
  const idLista = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TickerResult[]>([]);
  const [resultsFor, setResultsFor] = useState(""); // consulta a la que corresponden `results`
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const pendiente = useRef<{ q: string; ctl: AbortController; promesa: Promise<TickerResult[]> } | null>(null);

  // Una búsqueda NUEVA cancela la anterior: sin esto, la respuesta de «app» podía llegar
  // DESPUÉS de la de «apple» y pisarla. La MISMA consulta ya en camino se comparte: un Enter
  // rápido y la espera del tecleo piden lo mismo, y si la segunda cancelaba a la primera el
  // Enter se quedaba sin resultados.
  const fetchResults = useCallback((q: string): Promise<TickerResult[]> => {
    if (pendiente.current?.q === q) return pendiente.current.promesa;
    pendiente.current?.ctl.abort();
    const ctl = new AbortController();
    const vigente = () => pendiente.current?.ctl === ctl;
    const plazo = setTimeout(() => ctl.abort(), 8000);
    setLoading(true);
    const promesa = (async () => {
      try {
        const r = await authedFetch<{ results?: TickerResult[] }>(
          `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`, { signal: ctl.signal },
        );
        const lista = Array.isArray(r?.results) ? r.results : [];
        if (vigente()) { setResults(lista); setResultsFor(q); setActive(lista.length ? 0 : -1); }
        return lista;
      } catch {
        if (vigente()) { setResults([]); setResultsFor(q); setActive(-1); }
        return [];
      } finally {
        clearTimeout(plazo);
        if (vigente()) { pendiente.current = null; setLoading(false); }
      }
    })();
    pendiente.current = { q, ctl, promesa };
    return promesa;
  }, [limit]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return; // el vaciado lo hace limpiar(), desde quien borra
    const h = setTimeout(() => { void fetchResults(q); }, ESPERA_MS);
    return () => clearTimeout(h);
  }, [query, fetchResults]);

  useEffect(() => () => pendiente.current?.ctl.abort(), []);

  function limpiar() {
    pendiente.current?.ctl.abort();
    pendiente.current = null;
    setQuery(""); setResults([]); setResultsFor(""); setActive(-1); setLoading(false);
  }

  function go(symbol: string) {
    limpiar();
    setOpen(false);
    if (variant === "nav") inputRef.current?.blur();
    router.push(`/stock/${symbol}`);
  }

  // Enter elige la sugerencia marcada (la primera, si no se ha movido). Si se pulsa antes de
  // que lleguen las sugerencias, se espera a ellas: «apple» + Enter rápido tiene que ir a AAPL,
  // no a /stock/APPLE.
  async function submit() {
    const q = query.trim();
    if (!q) return;
    const alDia = resultsFor === q && !loading;
    const lista = alDia ? results : await fetchResults(q);
    const elegido = lista[alDia && active >= 0 ? active : 0];
    if (elegido) go(elegido.symbol);
    else if (PARECE_TICKER.test(q)) go(q.toUpperCase());
    else setOpen(true); // se queda abierto con «No matches»
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else limpiar();
    }
  }

  const q = query.trim();
  const sinResultados = !loading && resultsFor === q && results.length === 0;
  const mostrar = open && q.length > 0 && (results.length > 0 || loading || sinResultados);
  const hero = variant === "hero";

  return (
    <form
      role="search"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
      style={{ display: "flex", gap: "var(--sr-sp-3)", ...style }}
    >
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <input
          ref={inputRef}
          className={hero ? "sr-input" : undefined}
          type="text"
          role="combobox"
          aria-label={placeholder}
          aria-autocomplete="list"
          aria-expanded={mostrar}
          aria-controls={idLista}
          aria-activedescendant={mostrar && active >= 0 && results[active] ? `${idLista}-${active}` : undefined}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            if (!e.target.value.trim()) { limpiar(); return; }
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={50}
          style={hero ? { width: "100%" } : {
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
        {mostrar && (
          <ul
            id={idLista}
            role="listbox"
            className={`ticker-search-panel ${hero ? "" : "ticker-search-panel--nav"}`}
            // Sin esto, pulsar una opción quitaba el foco al input y el panel se cerraba
            // antes de que llegara el clic.
            onMouseDown={(e) => e.preventDefault()}
            style={{
              listStyle: "none", margin: 0, padding: 0,
              background: "var(--sr-surface)", border: "1px solid var(--sr-border-2)",
              borderRadius: "var(--sr-radius)", boxShadow: "var(--sr-shadow-lg)",
              zIndex: 500, overflow: "hidden", textAlign: "left",
            }}
          >
            {results.length === 0 ? (
              <li style={{ padding: "10px 14px", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)" }}>
                {loading ? t("Searching…") : t("No matches")}
              </li>
            ) : results.map((s, i) => (
              <li
                key={s.symbol}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={i === active}
                onClick={() => go(s.symbol)}
                onMouseEnter={() => setActive(i)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: hero ? "9px 14px" : "8px 12px",
                  cursor: "pointer",
                  background: i === active ? "var(--sr-surface-3)" : "transparent",
                  borderBottom: i < results.length - 1 ? "1px solid var(--sr-border)" : "none",
                  opacity: loading ? 0.6 : 1,
                }}
              >
                <span aria-hidden style={{ fontSize: 14, width: 20, lineHeight: 1, flexShrink: 0 }}>{tickerFlag(s.symbol)}</span>
                <span style={{
                  fontWeight: 600, color: "var(--sr-amber)", fontSize: "var(--sr-t-xs)",
                  width: 84, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono, ui-monospace, monospace)",
                }}>
                  {s.symbol}
                </span>
                <span style={{
                  color: "var(--sr-text-2)", fontSize: "var(--sr-t-xs)",
                  flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  <Resaltado texto={s.name} consulta={q} color="var(--sr-text)" />
                </span>
                {s.type === "etf" && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: "var(--sr-text-3)", flexShrink: 0,
                    border: "1px solid var(--sr-border-2)", borderRadius: 4, padding: "0 4px",
                  }}>
                    ETF
                  </span>
                )}
                {s.exchange && (
                  <span style={{ color: "var(--sr-text-3)", fontSize: 10, flexShrink: 0 }}>{s.exchange}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {submitLabel && (
        <button type="submit" className="btn-primary" style={{ flexShrink: 0 }}>{submitLabel}</button>
      )}
    </form>
  );
}
