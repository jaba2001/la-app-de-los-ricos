"use client";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { Sentry.captureException(error); }, [error]);

  return (
    <html>
      <body style={{
        margin: 0, background: "#FAFAF7", color: "#0E1A2B",
        fontFamily: "'Segoe UI',system-ui,sans-serif",
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", padding: 32,
      }}>
        <div style={{ maxWidth: 640, width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#0B6E4F", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M2 14L7 8L10 11L15 5" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span style={{ fontWeight: 700, fontSize: 18 }}>Scora Research</span>
          </div>
          <div style={{ background: "#FFFFFF", border: "1px solid #B42318", borderRadius: 12, padding: 24, marginBottom: 16 }}>
            <div style={{ color: "#B42318", fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
              Error Details
            </div>
            <pre style={{ color: "#0E1A2B", fontSize: 13, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {error.message || "Unknown error"}
            </pre>
          </div>
          {error.stack && (
            <div style={{ background: "#FFFFFF", border: "1px solid #1E3A5F", borderRadius: 12, padding: 24, marginBottom: 16 }}>
              <div style={{ color: "#94A3B8", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                Stack Trace
              </div>
              <pre style={{ color: "#4A6080", fontSize: 11, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {error.stack}
              </pre>
            </div>
          )}
          {error.digest && (
            <div style={{ color: "#4A6080", fontSize: 11, marginBottom: 16 }}>Digest: {error.digest}</div>
          )}
          <button
            onClick={reset}
            style={{
              background: "#0B6E4F", color: "#FFFFFF", border: "none",
              borderRadius: 8, padding: "10px 20px", fontWeight: 700,
              fontSize: 14, cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
