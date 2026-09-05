"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();
  const [status, setStatus] = useState("Verifying your link…");

  useEffect(() => {
    // Supabase JS automatically reads the #access_token hash from the URL
    // and fires SIGNED_IN via onAuthStateChange.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        setStatus("Signed in — redirecting…");
        router.replace("/macro");
      }
      if (event === "TOKEN_REFRESHED" && session) {
        router.replace("/macro");
      }
    });

    // Also check if session already exists (e.g. page refresh)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace("/macro");
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "#070E1A",
      color: "#F0F4F8",
      fontFamily: "'SF Pro Display','Segoe UI',system-ui,sans-serif",
      gap: 20,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14,
        background: "#F59E0B",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          <path d="M3 19L10 11L15 16L22 6" stroke="#070E1A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="22" cy="6" r="2.5" fill="#070E1A"/>
        </svg>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Scora Research</div>
        <div style={{ fontSize: 13, color: "#94A3B8" }}>{status}</div>
      </div>
      <div style={{
        width: 32, height: 32, border: "2px solid #1E3A5F",
        borderTopColor: "#F59E0B", borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
