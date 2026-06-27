"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && session) router.replace("/macro");
  }, [session, loading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: "https://scora-research.vercel.app/auth/callback" },
    });
    if (error) { setError(error.message); setSubmitting(false); return; }
    setSent(true);
    setSubmitting(false);
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
              <path d="M3 19L10 11L15 16L22 6" stroke="#070E1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="22" cy="6" r="2.5" fill="#070E1A"/>
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.03em" }}>
              Scora Research
            </h1>
            <p style={{ fontSize: "var(--sr-t-base)", color: "var(--sr-text-3)", marginTop: 6 }}>
              Macro + Stock intelligence platform
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="card" style={{ boxShadow: "var(--sr-shadow-lg)" }}>
          {!sent ? (
            <form onSubmit={handleSubmit}>
              <label style={{ display: "block", marginBottom: "var(--sr-sp-2)", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", fontWeight: 500 }}>
                Email
              </label>
              <input
                className="sr-input"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
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
                {submitting ? "Sending…" : "Send magic link"}
              </button>
            </form>
          ) : (
            <div style={{ textAlign: "center", padding: "var(--sr-sp-4) 0" }}>
              <div style={{ fontSize: "2rem", marginBottom: "var(--sr-sp-3)" }}>✉️</div>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>Check your email</p>
              <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>
                We sent a magic link to <strong style={{ color: "var(--sr-amber)" }}>{email}</strong>
              </p>
              <button
                className="btn-ghost"
                style={{ marginTop: "var(--sr-sp-5)", width: "100%" }}
                onClick={() => setSent(false)}
              >
                Use a different email
              </button>
            </div>
          )}
        </div>

        <p style={{ textAlign: "center", marginTop: "var(--sr-sp-5)", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
          No password needed — secure magic link authentication
        </p>
      </div>
    </div>
  );
}
