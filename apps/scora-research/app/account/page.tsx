"use client";
// Tu cuenta: quién eres y cómo borrarlo todo (RGPD, art. 17 — AUDIT_REPORT A-6).
//
// El borrado va en dos pasos y en este orden:
//   1. DELETE /api/cuenta borra los datos en Cloud SQL, en una transacción.
//   2. deleteUser() borra la identidad en Identity Platform.
// Al revés, un fallo del paso 2 dejaría datos sin dueño que ya nadie podría pedir borrar.
// Así, un fallo del paso 2 deja una cuenta vacía que se puede volver a intentar.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteUser } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/auth";
import { authedFetch } from "@/lib/proxy";

const FRASE = "DELETE";

export default function AccountPage() {
  const { session, loading, signOut } = useAuth();
  const router = useRouter();
  const [confirmacion, setConfirmacion] = useState("");
  const [estado, setEstado] = useState<"idle" | "borrando" | "hecho">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !session && estado !== "hecho") router.replace("/login");
  }, [loading, session, router, estado]);

  async function borrar() {
    setEstado("borrando");
    setError("");
    try {
      await authedFetch("/api/cuenta", { method: "DELETE" });
    } catch (e) {
      const m = (e as Error).message;
      setError(/subscription_active|Cancel your subscription/.test(m)
        ? "You have an active subscription. Cancel it from Billing on the Pricing page first, then delete your account."
        : "We couldn't delete your data. Nothing was deleted — please try again.");
      setEstado("idle");
      return;
    }
    try {
      const u = auth().currentUser;
      if (u) await deleteUser(u);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === "auth/requires-recent-login"
        ? "Your data has been deleted. To remove the login itself, sign in again and repeat this step (it's a security check)."
        : "Your data has been deleted, but the login could not be removed. Sign in again and repeat this step.");
      await signOut();
      setEstado("idle");
      return;
    }
    setEstado("hecho");
  }

  if (estado === "hecho") {
    return (
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "var(--sr-sp-6)" }}>
        <h1 style={{ fontSize: "var(--sr-t-xl)", marginBottom: "var(--sr-sp-3)" }}>Account deleted</h1>
        <p style={{ color: "var(--sr-text-2)" }}>Your account and all its data have been deleted.</p>
      </div>
    );
  }
  if (!session) return null;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "var(--sr-sp-6)" }}>
      <h1 style={{ fontSize: "var(--sr-t-xl)", marginBottom: "var(--sr-sp-4)" }}>Your account</h1>
      <p style={{ color: "var(--sr-text-2)", marginBottom: "var(--sr-sp-5)" }}>
        Signed in as <strong style={{ color: "var(--sr-text)" }}>{session.user.email ?? "—"}</strong>
      </p>

      <section style={{ border: "1px solid color-mix(in srgb, var(--sr-neg) 45%, var(--sr-border))", borderRadius: "var(--sr-radius-lg, 14px)", padding: "var(--sr-sp-5)" }}>
        <h2 style={{ fontSize: "var(--sr-t-base)", marginBottom: "var(--sr-sp-2)" }}>Delete account</h2>
        <p style={{ color: "var(--sr-text-2)", fontSize: "var(--sr-t-sm)", lineHeight: 1.6, marginBottom: "var(--sr-sp-3)" }}>
          This permanently deletes your login and everything linked to it: watchlist, journal,
          alerts and their preferences, saved analyses and snapshots, push subscriptions, your
          AI history and your waitlist sign-up. It can&apos;t be undone.
        </p>
        <label style={{ display: "block", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginBottom: "var(--sr-sp-2)" }}>
          Type <strong>{FRASE}</strong> to confirm
        </label>
        <input
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          autoComplete="off"
          style={{ width: "100%", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)", color: "var(--sr-text)", padding: "8px 12px", marginBottom: "var(--sr-sp-3)", fontFamily: "inherit" }}
        />
        {error && <p role="alert" style={{ color: "var(--sr-neg)", fontSize: "var(--sr-t-sm)", marginBottom: "var(--sr-sp-3)" }}>{error}</p>}
        <button
          onClick={borrar}
          disabled={confirmacion !== FRASE || estado === "borrando"}
          style={{ background: "var(--sr-neg)", color: "#fff", border: "none", borderRadius: "var(--sr-radius)", padding: "10px 18px", fontWeight: 700, cursor: confirmacion === FRASE ? "pointer" : "not-allowed", opacity: confirmacion === FRASE ? 1 : 0.5 }}
        >
          {estado === "borrando" ? "Deleting…" : "Delete my account"}
        </button>
      </section>
    </div>
  );
}
