"use client";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // This boundary already showed the user a good error page; what it never did was
  // tell US. Without this, a 3am crash on /stock/NVDA is invisible.
  useEffect(() => { Sentry.captureException(error); }, [error]);

  return (
    <div style={{
      minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: 32,
    }}>
      <div style={{ maxWidth: 600, width: "100%" }}>
        <div style={{
          background: "var(--sr-surface, #0D1B2E)",
          border: "1px solid #EF4444",
          borderRadius: 12, padding: 24, marginBottom: 16,
        }}>
          <div style={{ color: "#EF4444", fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
            Page Error
          </div>
          <pre style={{ color: "#F0F4F8", fontSize: 13, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {error.message || "Unknown error"}
          </pre>
        </div>
        {error.stack && (
          <pre style={{
            background: "var(--sr-surface, #0D1B2E)",
            border: "1px solid #1E3A5F",
            borderRadius: 12, padding: 24, fontSize: 11, color: "#4A6080",
            whiteSpace: "pre-wrap", wordBreak: "break-all", margin: "0 0 16px",
          }}>
            {error.stack}
          </pre>
        )}
        <button
          onClick={reset}
          style={{
            background: "#F59E0B", color: "#070E1A", border: "none",
            borderRadius: 8, padding: "10px 20px", fontWeight: 700,
            fontSize: 14, cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
