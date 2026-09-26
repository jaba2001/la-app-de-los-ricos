"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";

export default function AuthCallback() {
  const router = useRouter();
  const [status, setStatus] = useState("Verifying your link…");

  useEffect(() => {
    // Con Supabase bastaba escuchar: el SDK leia el token del hash de la URL solo. Identity
    // Platform pide completar la entrada a mano con el email, porque el enlace por si solo
    // no dice a quien pertenece — se puede abrir en otro navegador o reenviar.
    if (!isSignInWithEmailLink(auth(), window.location.href)) {
      setStatus("Este enlace no es válido o ya se usó.");
      return;
    }
    let email = window.localStorage.getItem("scora:emailLogin");
    if (!email) {
      // Caso real: el enlace se abre en otro dispositivo. Preguntarlo es el camino que
      // recomienda Google; el enlace solo sirve para ESE correo, asi que teclear otro falla.
      email = window.prompt("Confirma tu correo para completar el acceso") ?? "";
      if (!email) { setStatus("Hace falta el correo para completar el acceso."); return; }
    }
    signInWithEmailLink(auth(), email, window.location.href)
      .then(() => {
        window.localStorage.removeItem("scora:emailLogin");
        setStatus("Dentro — redirigiendo…");
        router.replace("/macro");
      })
      .catch((e) => setStatus(`No se pudo completar: ${(e as Error).message}`));
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
