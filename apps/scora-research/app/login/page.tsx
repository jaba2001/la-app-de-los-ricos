"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { sendSignInLinkToEmail, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n/cliente";
import Trans from "@/components/Trans";

// Lo que Firebase devuelve al fallar la ventana de Google, en palabras del usuario. Cerrar la
// ventana no es un error: se vuelve al formulario sin decir nada.
const ERRORES_GOOGLE: Record<string, string> = {
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/operation-not-allowed": "Google sign-in isn't enabled yet. Use the email link below for now.",
  "auth/unauthorized-domain": "This site isn't authorized for Google sign-in yet. Use the email link below for now.",
  "auth/account-exists-with-different-credential": "This email already has an account. Sign in once with the email link below.",
  "auth/network-request-failed": "Couldn't reach Google. Check your connection and try again.",
};
const SILENCIOSOS = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

export default function LoginPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [conGoogle, setConGoogle] = useState(false);

  useEffect(() => {
    if (!loading && session) router.replace("/macro");
  }, [session, loading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await sendSignInLinkToEmail(auth(), email, {
        // Identity Platform exige que el dominio esté en la lista de autorizados; si no,
        // devuelve auth/unauthorized-continue-uri. Se usa el origen actual para que funcione
        // igual en local y en Cloud Run sin tocar código.
        url: `${window.location.origin}/auth/callback`,
        handleCodeInApp: true,
      });
      // El correo hay que recordarlo: el enlace puede abrirse en otro navegador, y allí el
      // SDK no sabe a quién pertenece. Sin esto, la vuelta pide teclearlo otra vez.
      window.localStorage.setItem("scora:emailLogin", email);
    } catch (e) {
      setError((e as Error).message); setSubmitting(false); return;
    }
    setSent(true);
    setSubmitting(false);
  }

  // Ventana emergente y no redirección: con el dominio de Firebase distinto del de la app, la
  // redirección depende de almacenamiento de terceros que Safari y Chrome ya bloquean. Al volver,
  // onIdTokenChanged (lib/auth.tsx) crea la sesión y el efecto de arriba lleva a /macro.
  async function entrarConGoogle() {
    setConGoogle(true);
    setError("");
    try {
      const proveedor = new GoogleAuthProvider();
      proveedor.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth(), proveedor);
    } catch (e) {
      const codigo = (e as { code?: string }).code ?? "";
      if (!SILENCIOSOS.has(codigo)) setError(t(ERRORES_GOOGLE[codigo] ?? (e as Error).message));
      setConGoogle(false);
    }
  }

  if (loading) return null;

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "var(--sr-sp-5)",
      background: "var(--sr-bg)",
    }}>
      {/* Background glow */}
      <div style={{
        position: "fixed",
        top: "20%",
        left: "50%",
        transform: "translateX(-50%)",
        width: 600,
        height: 300,
        background: "radial-gradient(ellipse, color-mix(in srgb, var(--sr-amber) 6%, transparent) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div style={{
        width: "100%",
        maxWidth: 400,
        position: "relative",
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "var(--sr-sp-8)" }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: "var(--sr-amber)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "var(--sr-sp-4)",
            boxShadow: "var(--sr-shadow-amber)",
          }}>
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <path d="M3 19L10 11L15 16L22 6" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="22" cy="6" r="2.5" fill="#FFFFFF"/>
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.03em" }}>
              {t("Scora Research")}</h1>
            <p style={{ fontSize: "var(--sr-t-base)", color: "var(--sr-text-3)", marginTop: 6 }}>
              {t("Macro + Stock intelligence platform")}</p>
          </div>
        </div>

        {/* Card */}
        <div className="card" style={{ boxShadow: "var(--sr-shadow-lg)" }}>
          {!sent ? (
            <>
            <button
              type="button"
              onClick={entrarConGoogle}
              disabled={conGoogle}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                padding: "10px 16px", borderRadius: "var(--sr-radius)", cursor: conGoogle ? "default" : "pointer",
                background: "#FFFFFF", color: "#1F1F1F", border: "1px solid #DADCE0",
                fontSize: "var(--sr-t-base)", fontWeight: 600, fontFamily: "inherit",
              }}
            >
              {/* El logotipo de Google, tal como piden sus normas de marca para este botón */}
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              {conGoogle ? t("Opening Google…") : t("Continue with Google")}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", margin: "var(--sr-sp-4) 0", color: "var(--sr-text-3)", fontSize: "var(--sr-t-xs)" }}>
              <div style={{ flex: 1, height: 1, background: "var(--sr-border)" }} />
              {t("or with your email")}
              <div style={{ flex: 1, height: 1, background: "var(--sr-border)" }} />
            </div>
            <form onSubmit={handleSubmit}>
              <label style={{ display: "block", marginBottom: "var(--sr-sp-2)", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", fontWeight: 500 }}>
                {t("Email")}</label>
              <input
                className="sr-input"
                type="email"
                placeholder={t("your@email.com")}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                style={{ marginBottom: "var(--sr-sp-4)" }}
              />
              {error && (
                <div style={{
                  padding: "var(--sr-sp-2) var(--sr-sp-3)",
                  borderRadius: "var(--sr-radius-sm)",
                  background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)",
                  color: "var(--sr-neg)",
                  fontSize: "var(--sr-t-sm)",
                  marginBottom: "var(--sr-sp-3)",
                }}>
                  {error}
                </div>
              )}
              <button
                type="submit"
                className="btn-primary"
                style={{ width: "100%" }}
                disabled={submitting || !email}
              >
                {submitting ? t("Sending…") : t("Send magic link")}
              </button>
            </form>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "var(--sr-sp-4) 0" }}>
              <div style={{ fontSize: "2rem", marginBottom: "var(--sr-sp-3)" }}>✉️</div>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>{t("Check your email")}</p>
              <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>
                <Trans text={`We sent a magic link to <s1>${email}</s1>`} s1={(c) => <strong style={{ color: "var(--sr-amber)" }}>{c}</strong>} />
              </p>
              <button
                className="btn-ghost"
                style={{ marginTop: "var(--sr-sp-5)", width: "100%" }}
                onClick={() => setSent(false)}
              >
                {t("Use a different email")}</button>
            </div>
          )}
        </div>

        <p style={{ textAlign: "center", marginTop: "var(--sr-sp-5)", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
          {t("No password needed — sign in with Google or with a link sent to your email")}</p>
      </div>
    </div>
  );
}
