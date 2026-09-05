"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Sk } from "@/components/ui/Skeleton";

interface AuditRow {
  id: number; ticker: string | null; module: string; model: string | null;
  prompt_chars: number | null; sources: string[] | null; output: string | null;
  violations: (number | string)[] | null; grounded: boolean | null; created_at: string;
}

const MODULE_LABEL: Record<string, string> = {
  thesis: "Stock thesis", report: "Research note", redflags: "Red-flag scanner",
  moat: "Moat audit", bullbear: "Bull vs bear", macrosens: "Macro sensitivity",
  thesisupdate: "Thesis triggers", earnings: "Earnings tone", brief: "Scora brief",
};

export default function AuditPage() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => { if (!authLoading && !session) router.replace("/login"); }, [session, authLoading, router]);

  useEffect(() => {
    if (!session) return;
    supabase.from("ai_audit_log").select("*").order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => { setRows((data as AuditRow[]) ?? []); setLoaded(true); });
  }, [session]);

  const stats = useMemo(() => {
    const total = rows.length;
    const grounded = rows.filter((r) => r.grounded).length;
    const flagged = rows.filter((r) => (r.violations?.length ?? 0) > 0).length;
    return { total, grounded, flagged, pct: total ? Math.round((grounded / total) * 100) : 0 };
  }, [rows]);

  if (authLoading || !session) return null;

  return (
    <div style={{ padding: "var(--sr-sp-6)", maxWidth: 1000, margin: "0 auto" }} className="animate-fade-in">
      <div style={{ marginBottom: "var(--sr-sp-5)" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>AI Audit Trail</h1>
        <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 6, maxWidth: 720, lineHeight: 1.6 }}>
          Every grounded AI answer is logged here with the sources it cited and a <strong style={{ color: "var(--sr-text)" }}>code-enforced grounding check</strong> — the figures it emitted are verified against the data it was given. This is what makes the AI layer auditable: you can see exactly what it was told, what it said, and whether any number couldn&apos;t be traced back.
        </p>
      </div>

      {loaded && rows.length > 0 && (
        <div className="sr-grid-3" style={{ marginBottom: "var(--sr-sp-5)" }}>
          <div className="sr-tile"><div className="sr-tile-label">Logged runs</div><div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700 }} className="num">{stats.total}</div></div>
          <div className="sr-tile"><div className="sr-tile-label">Grounded</div><div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, color: "var(--sr-pos)" }} className="num">{stats.pct}%</div><div className="sr-hint">{stats.grounded}/{stats.total} clean</div></div>
          <div className="sr-tile"><div className="sr-tile-label">Flagged figures</div><div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, color: stats.flagged ? "var(--sr-warn)" : "var(--sr-text)" }} className="num">{stats.flagged}</div><div className="sr-hint">runs with unverified numbers</div></div>
        </div>
      )}

      {!loaded ? (
        <Sk w="100%" h={320} />
      ) : rows.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)", lineHeight: 1.6 }}>
          No AI runs logged yet. Generate a <strong style={{ color: "var(--sr-text-2)" }}>thesis</strong>, <strong style={{ color: "var(--sr-text-2)" }}>research note</strong> or a <strong style={{ color: "var(--sr-text-2)" }}>due-diligence</strong> module on any stock — each grounded output is recorded here with its sources and grounding check.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="sr-table">
            <thead><tr>
              <th>When</th><th>Module</th><th>Ticker</th><th>Grounding</th><th style={{ textAlign: "right" }}>Sources</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const flagged = (r.violations?.length ?? 0) > 0;
                const isOpen = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : r.id)}>
                      <td style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-xs)", whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                      <td style={{ fontWeight: 600 }}>{MODULE_LABEL[r.module] ?? r.module}</td>
                      <td style={{ color: "var(--sr-amber)", fontWeight: 700 }}>{r.ticker ?? "—"}</td>
                      <td>
                        <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "var(--sr-radius-pill)", background: `color-mix(in srgb, ${flagged ? "var(--sr-warn)" : "var(--sr-pos)"} 14%, transparent)`, color: flagged ? "var(--sr-warn)" : "var(--sr-pos)" }}>
                          {flagged ? `⚠ ${r.violations!.length} flagged` : "✓ grounded"}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", color: "var(--sr-text-3)", fontSize: "var(--sr-t-xs)" }}>{r.sources?.length ?? 0}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} style={{ background: "var(--sr-surface-2)", padding: "var(--sr-sp-3) var(--sr-sp-4)" }}>
                          <div style={{ display: "flex", gap: "var(--sr-sp-4)", flexWrap: "wrap", fontSize: "10px", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-2)" }}>
                            <span>Model: <strong style={{ color: "var(--sr-text-2)" }}>{r.model ?? "—"}</strong></span>
                            <span>Prompt: <strong style={{ color: "var(--sr-text-2)" }}>{r.prompt_chars ?? "—"} chars</strong></span>
                            {r.sources?.length ? <span>Sources cited: <strong style={{ color: "var(--sr-text-2)" }}>{r.sources.join(", ")}</strong></span> : null}
                            {flagged && <span style={{ color: "var(--sr-warn)" }}>Unverified figures: {r.violations!.join(", ")}</span>}
                          </div>
                          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 320, overflowY: "auto", borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-2)" }}>{r.output ?? "(no output stored)"}</div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ textAlign: "right", fontSize: "10px", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-4)" }}>
        Your last {rows.length} AI runs · grounding gate: lib/grounding.ts · logged to ai_audit_log (owner-only). Educational — not advice.
      </div>
    </div>
  );
}
