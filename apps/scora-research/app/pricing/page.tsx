"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useEntitlements } from "@/lib/entitlements";
import { track } from "@/lib/analytics";

// Mismo origen: el backend vive en app/api de esta misma app.
const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? "";

interface StripeConfig {
  enabled: boolean;
  test_mode: boolean;
  price: { unit_amount: number; currency: string; interval: string | null } | null;
}

/**
 * Estado de los pagos, preguntado al proxy.
 *
 * No hay una NEXT_PUBLIC_STRIPE_ENABLED a propósito: sería una segunda copia de la verdad, y
 * el día que no coincida con la del servidor el usuario ve un botón de pagar que devuelve
 * 503. Mientras no responda, `null` significa "aún no se sabe" y la tarjeta no promete nada.
 */
function useStripeConfig(): StripeConfig | null {
  const [cfg, setCfg] = useState<StripeConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${PROXY}/api/stripe/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setCfg(d as StripeConfig); })
      // Proxy caído o versión antigua sin la ruta: se cae a la lista de espera, que es el
      // estado correcto mientras no se demuestre que hay pagos.
      .catch(() => { if (!cancelled) setCfg({ enabled: false, test_mode: false, price: null }); });
    return () => { cancelled = true; };
  }, []);
  return cfg;
}

function formatPrice(p: StripeConfig["price"]): string | null {
  if (!p) return null;
  const amount = (p.unit_amount / 100).toLocaleString("en-IE", {
    style: "currency", currency: p.currency.toUpperCase(),
    // 9 € se lee mejor que 9,00 €; 9,50 € necesita sus decimales.
    minimumFractionDigits: p.unit_amount % 100 === 0 ? 0 : 2,
  });
  return p.interval === "year" ? `${amount}/yr` : p.interval === "month" ? `${amount}/mo` : amount;
}

/**
 * Los límites de IA se PIDEN al proxy, no se escriben aquí.
 *
 * Viven en variables de entorno del servidor para poder ajustarlos sin desplegar; una copia
 * en esta página se desincronizaría en el primer cambio y estaríamos anunciando una cifra
 * distinta de la que se aplica. Mientras no responda se dice "AI analysis daily", sin
 * número: vago pero cierto, que es preferible a concreto y falso.
 */
function useAiLimits(): { free: number; pro: number } | null {
  const [limits, setLimits] = useState<{ free: number; pro: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${PROXY}/api/ai/limits`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        if (Number.isFinite(d.free) && Number.isFinite(d.pro)) setLimits(d);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return limits;
}

function freeFeatures(limits: { free: number; pro: number } | null) {
  return [
    "Macro regime + validated allocator",
    "Live track record & AI audit trail",
    "Stock, bond & instrument analysis",
    limits ? `${limits.free} AI analyses / day` : "AI analysis daily",
    "Discovery screener (stocks + cross-asset)",
  ];
}

function proFeatures(limits: { free: number; pro: number } | null) {
  return [
    "Everything in Free",
    // "Ilimitado" sería mentira: hay un tope, alto pero real. Decir la cifra vale más que
    // una promesa que el primer usuario intensivo descubriría que es falsa.
    limits ? `${limits.pro} AI analyses / day (${Math.round(limits.pro / Math.max(1, limits.free))}× Free)` : "Far higher AI limits",
    "Regime-change & divergence alerts",
    "Watchlist signal notifications",
    "HTML research-note export",
  ];
}

/** Lista de espera. Es el estado por defecto y el que decide si Pro llega a existir. */
function WaitlistForm({ defaultEmail, accessToken }: { defaultEmail: string; accessToken: string | null }) {
  const [email, setEmail] = useState(defaultEmail);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending"); setError("");
    try {
      // Se manda el token de sesión, no un id de usuario: el proxy atribuye la fila desde el
      // token VERIFICADO (lib/auth.js optionalUser) e ignora cualquier id del cuerpo, que
      // sería una afirmación de identidad sin autenticar.
      const res = await fetch(`${PROXY}/api/waitlist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          email, tier: "pro", source: "pricing",
          referrer: typeof document !== "undefined" ? document.referrer.slice(0, 200) : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setState("error"); setError(body?.error || "Something went wrong. Try again."); return; }
      track("waitlist_submitted");
      setState("done");
    } catch {
      setState("error");
      setError("Network error. Try again in a moment.");
    }
  }

  if (state === "done") {
    return (
      <div style={{ marginTop: "var(--sr-sp-5)", fontSize: "var(--sr-t-sm)", color: "var(--sr-pos)", lineHeight: 1.5 }}>
        ✓ You&apos;re on the list. We&apos;ll email you once — when there&apos;s something real to try.
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginTop: "var(--sr-sp-5)", display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com" aria-label="Email for the Pro waitlist"
        style={{
          width: "100%", borderRadius: "var(--sr-radius)", padding: "9px 12px",
          fontSize: "var(--sr-t-sm)", background: "var(--sr-surface-2)",
          border: "1px solid var(--sr-border)", color: "var(--sr-text)",
        }}
      />
      <button type="submit" disabled={state === "sending"} className="sr-btn-amber" style={{ opacity: state === "sending" ? 0.6 : 1 }}>
        {state === "sending" ? "Adding…" : "Notify me"}
      </button>
      {error && <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-neg)", lineHeight: 1.4 }}>{error}</div>}
      <div style={{ fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.5 }}>
        One email when Pro launches. No newsletter, no sharing.
      </div>
    </form>
  );
}

/** Botón de pago. Solo aparece cuando el servidor confirma que puede cobrar. */
function UpgradeButton({ accessToken, onNeedsLogin }: { accessToken: string | null; onNeedsLogin: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    if (busy) return;
    if (!accessToken) { onNeedsLogin(); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch(`${PROXY}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        setBusy(false);
        setError(body?.error || "Could not start checkout. Try again.");
        return;
      }
      track("checkout_started");
      // Se sale a Stripe: no se quita el estado ocupado, porque la página se está yendo y
      // rehabilitar el botón solo invita a un segundo clic que abriría otro checkout.
      window.location.href = body.url;
    } catch {
      setBusy(false);
      setError("Network error. Try again in a moment.");
    }
  }

  return (
    <div style={{ marginTop: "var(--sr-sp-5)" }}>
      <button onClick={go} disabled={busy} className="sr-btn-amber" style={{ opacity: busy ? 0.6 : 1 }}>
        {busy ? "Opening checkout…" : "Upgrade to Pro"}
      </button>
      {error && <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-neg)", lineHeight: 1.4, marginTop: 8 }}>{error}</div>}
      <div style={{ fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.5, marginTop: 8 }}>
        Cancel anytime from the billing portal. Card details never touch our servers.
      </div>
    </div>
  );
}

/** Estado de quien ya paga: cuándo se renueva y cómo cancelar sin escribirnos. */
function ManageBilling({ accessToken, sub }: {
  accessToken: string | null;
  sub: { current_period_end: string | null; cancel_at_period_end: boolean; status: string } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function openPortal() {
    if (busy || !accessToken) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`${PROXY}/api/stripe/portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) { setBusy(false); setError(body?.error || "Could not open billing."); return; }
      window.location.href = body.url;
    } catch {
      setBusy(false);
      setError("Network error. Try again in a moment.");
    }
  }

  const until = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div style={{ marginTop: "var(--sr-sp-5)" }}>
      <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-pos)", fontWeight: 700, marginBottom: 8 }}>
        ✓ You&apos;re on Pro
      </div>
      {until && (
        <div className="sr-hint" style={{ marginBottom: 10, lineHeight: 1.5 }}>
          {/* Cancelada pero pagada hasta el final del periodo: decirlo evita el susto de
              "he cancelado y sigo teniendo acceso, ¿me van a cobrar otra vez?". */}
          {sub?.cancel_at_period_end ? `Access until ${until}. Won't renew.` : `Renews ${until}.`}
        </div>
      )}
      {sub?.status === "past_due" && (
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-neg)", lineHeight: 1.5, marginBottom: 10 }}>
          Last payment failed. Update your card to keep Pro — access continues meanwhile.
        </div>
      )}
      <button onClick={openPortal} disabled={busy} style={{
        width: "100%", borderRadius: "var(--sr-radius)", padding: "10px 0",
        fontSize: "var(--sr-t-sm)", fontWeight: 700, cursor: busy ? "default" : "pointer",
        background: "var(--sr-surface-2)", color: "var(--sr-text)",
        border: "1px solid var(--sr-border)", opacity: busy ? 0.6 : 1,
      }}>
        {busy ? "Opening…" : "Manage billing"}
      </button>
      {error && <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-neg)", lineHeight: 1.4, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

export default function Pricing() {
  const { session } = useAuth();
  const { isPro, loading: entLoading, subscription, refresh } = useEntitlements();
  const cfg = useStripeConfig();
  const limits = useAiLimits();
  const router = useRouter();

  // ?checkout=success|cancelled. Se lee de window en vez de useSearchParams porque ese hook
  // obliga a envolver la página en <Suspense> y, sin él, Next falla la generación estática
  // del build. Aquí no hace falta: solo se necesita en el cliente y una vez.
  const [outcome, setOutcome] = useState<"success" | "cancelled" | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("checkout");
    if (q === "success" || q === "cancelled") {
      setOutcome(q);
      // Se limpia la URL: recargar no debe repetir el mensaje, y menos aún parecer un
      // segundo cobro.
      window.history.replaceState({}, "", window.location.pathname);
      if (q === "success") track("checkout_completed");
    }
  }, []);

  // Tras pagar, el webhook puede tardar unos segundos en escribir la fila. Se reintenta un
  // rato corto en vez de enseñar "Free" a quien acaba de pagar.
  const tries = useRef(0);
  const waitingForWebhook = outcome === "success" && !isPro && !entLoading;
  useEffect(() => {
    if (!waitingForWebhook || tries.current >= 10) return;
    const t = setTimeout(() => { tries.current += 1; refresh(); }, 2000);
    return () => clearTimeout(t);
  }, [waitingForWebhook, refresh, isPro]);

  const go = useCallback(() => router.push(session ? "/macro" : "/login"), [router, session]);
  // El token ya no es un campo de la sesión sino una función que lo renueva: guardarlo
  // como valor daría 401 a la hora, cuando caduca. Se resuelve aquí y se vuelve a pedir
  // cada vez que la sesión cambia (Identity Platform lo renueva solo y dispara el efecto).
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    if (!session) { setToken(null); return; }
    // Con .catch: si el token no se puede renovar (caducado, red caida) hay que dejarlo en
    // null y que el boton lo trate como "sin sesion". Sin el quedaba una promesa sin capturar
    // y el boton de pago se quedaba mudo, sin avisar de nada.
    session.getToken()
      .then((t) => { if (vivo) setToken(t); })
      .catch(() => { if (vivo) setToken(null); });
    return () => { vivo = false; };
  }, [session]);
  const priceLabel = formatPrice(cfg?.price ?? null);

  // Qué enseña la tarjeta Pro. El orden importa: quien ya paga ve su gestión aunque el
  // config tarde; y mientras no se sepa si hay pagos, no se promete un botón que puede fallar.
  const proBody = isPro
    ? <ManageBilling accessToken={token} sub={subscription} />
    : cfg?.enabled
      ? <UpgradeButton accessToken={token} onNeedsLogin={() => router.push("/login")} />
      : <WaitlistForm defaultEmail={session?.user?.email ?? ""} accessToken={token} />;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "var(--sr-sp-6)" }}>
      <div style={{ textAlign: "center", marginBottom: "var(--sr-sp-6)" }}>
        <h1 style={{ fontSize: "var(--sr-t-3xl, 34px)", fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>Pricing</h1>
        <p style={{ fontSize: "var(--sr-t-base)", color: "var(--sr-text-2)", marginTop: "var(--sr-sp-3)", maxWidth: 560, marginInline: "auto", lineHeight: 1.6 }}>
          The engine runs entirely on free data, so the core is <strong style={{ color: "var(--sr-text)" }}>free forever</strong>. A Pro tier will only add convenience (higher limits, alerts) — never the analysis itself.
        </p>
      </div>

      {outcome === "success" && (
        <div role="status" style={{
          marginBottom: "var(--sr-sp-5)", padding: "var(--sr-sp-4)", borderRadius: "var(--sr-radius-lg, 14px)",
          background: "color-mix(in srgb, var(--sr-pos) 10%, transparent)",
          border: "1px solid color-mix(in srgb, var(--sr-pos) 40%, transparent)",
          fontSize: "var(--sr-t-sm)", lineHeight: 1.6,
        }}>
          {isPro
            ? "✓ Payment received — Pro is active. Thank you."
            : "✓ Payment received. Activating your account… this usually takes a few seconds."}
        </div>
      )}
      {outcome === "cancelled" && (
        <div role="status" style={{
          marginBottom: "var(--sr-sp-5)", padding: "var(--sr-sp-4)", borderRadius: "var(--sr-radius-lg, 14px)",
          background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)",
          fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.6,
        }}>
          Checkout cancelled — nothing was charged. The free tier keeps working as before.
        </div>
      )}

      {cfg?.test_mode && (
        // Si esto sale en producción es un error de configuración grave: se está enseñando un
        // checkout que no cobra. Vale más gritarlo que descubrirlo por los ingresos a cero.
        <div style={{
          marginBottom: "var(--sr-sp-5)", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)",
          background: "color-mix(in srgb, var(--sr-amber) 12%, transparent)",
          border: "1px dashed color-mix(in srgb, var(--sr-amber) 55%, transparent)",
          fontSize: "var(--sr-t-xs)", textAlign: "center",
        }}>
          Stripe is in <strong>test mode</strong> — no real charges. Use card 4242 4242 4242 4242.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "var(--sr-sp-4)" }}>
        {/* Free */}
        <div style={{
          background: "var(--sr-surface)", borderRadius: 16, padding: "var(--sr-sp-5)",
          border: "1px solid var(--sr-border)",
        }}>
          <div className="sr-flex-between" style={{ alignItems: "baseline" }}>
            <span style={{ fontSize: "var(--sr-t-lg)", fontWeight: 800 }}>Free</span>
            <span style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: "var(--sr-amber)" }} className="num">€0</span>
          </div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, marginBottom: "var(--sr-sp-4)" }}>
            The whole engine, forever.
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
            {freeFeatures(limits).map((f) => (
              <li key={f} style={{ display: "flex", gap: 8, fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.4 }}>
                <span style={{ color: "var(--sr-pos)", flexShrink: 0 }}>✓</span>{f}
              </li>
            ))}
          </ul>
          <button onClick={go} style={{
            width: "100%", marginTop: "var(--sr-sp-5)", borderRadius: "var(--sr-radius)", padding: "10px 0",
            fontSize: "var(--sr-t-sm)", fontWeight: 700, cursor: "pointer",
            background: "var(--sr-surface-2)", color: "var(--sr-text)", border: "1px solid var(--sr-border)",
          }}>Start free</button>
        </div>

        {/* Pro */}
        <div style={{
          background: "var(--sr-surface)", borderRadius: 16, padding: "var(--sr-sp-5)",
          border: "1.5px solid color-mix(in srgb, var(--sr-amber) 55%, transparent)",
          boxShadow: "0 0 0 4px color-mix(in srgb, var(--sr-amber) 8%, transparent)",
        }}>
          <div className="sr-flex-between" style={{ alignItems: "baseline" }}>
            <span style={{ fontSize: "var(--sr-t-lg)", fontWeight: 800 }}>Pro</span>
            <span style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: "var(--sr-amber)" }} className="num">
              {/* El importe viene de Stripe. Mientras no haya pagos sigue el "€0*" honesto de
                  siempre, que la nota al pie explica. */}
              {priceLabel ?? "€0*"}
            </span>
          </div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, marginBottom: "var(--sr-sp-4)" }}>
            {cfg?.enabled ? "For heavy users." : "For heavy users — when it exists."}
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
            {proFeatures(limits).map((f) => (
              <li key={f} style={{ display: "flex", gap: 8, fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.4 }}>
                <span style={{ color: "var(--sr-pos)", flexShrink: 0 }}>✓</span>{f}
              </li>
            ))}
          </ul>
          {proBody}
        </div>
      </div>

      <p style={{ fontSize: "10px", color: "var(--sr-text-3)", textAlign: "center", marginTop: "var(--sr-sp-5)", lineHeight: 1.6, maxWidth: 620, marginInline: "auto" }}>
        {cfg?.enabled
          ? "Billing is handled by Stripe; card details never reach our servers. Cancel anytime. Educational tool, not investment advice."
          : "* No monthly cost to you. If a paid tier launches, any processor fee applies only to what you actually earn — never a fixed charge. Educational tool, not investment advice."}
      </p>
    </div>
  );
}
