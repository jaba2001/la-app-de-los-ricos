"use client";
import type { MacroState } from "@/lib/types";
import { GEO_REGIONS, geopoliticalRead } from "@/lib/geopolitics";
import { Sk } from "@/components/ui/Skeleton";

interface Props { macro: MacroState | null; loading: boolean; }

export default function MacroGeopolitics({ macro, loading }: Props) {
  if (loading) return <Sk w="100%" h={400} />;
  const read = geopoliticalRead(macro);

  return (
    <div className="animate-fade-in">
      {/* Live read */}
      {read && (
        <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
          <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
            <div className="section-label" style={{ margin: 0 }}>Geopolitical read</div>
            <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 800, color: read.color, padding: "2px 12px", borderRadius: "var(--sr-radius-pill)", background: `color-mix(in srgb, ${read.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${read.color} 30%, transparent)` }}>
              {read.level} risk
            </span>
          </div>
          <ul style={{ margin: 0, paddingLeft: "var(--sr-sp-4)", display: "flex", flexDirection: "column", gap: 4 }}>
            {read.drivers.map((d, i) => (
              <li key={i} style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.5 }}>{d}</li>
            ))}
          </ul>
          <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", fontSize: "var(--sr-t-sm)", color: "var(--sr-text)", lineHeight: 1.6 }}>
            <strong style={{ color: read.color }}>Asset tilt:</strong> {read.tilt}
          </div>
          <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>Context layer only — it informs the read, it does not change Scora&apos;s validated regime allocator weights.</div>
        </div>
      )}

      {/* Power-bloc map */}
      <div className="card" style={{ padding: 0 }}>
        <div className="section-label" style={{ padding: "var(--sr-sp-4) var(--sr-sp-4) 0" }}>Power blocs — what to watch &amp; the assets they move</div>
        <table className="sr-table">
          <thead><tr><th>Region</th><th>Role</th><th>What to watch</th><th>Assets it moves</th></tr></thead>
          <tbody>
            {GEO_REGIONS.map((r) => (
              <tr key={r.region}>
                <td style={{ fontWeight: 700, color: "var(--sr-text)", whiteSpace: "nowrap" }}>{r.region}</td>
                <td style={{ color: "var(--sr-text-2)" }}>{r.role}</td>
                <td style={{ color: "var(--sr-text-2)" }}>{r.watch}</td>
                <td style={{ color: "var(--sr-text-3)" }}>{r.assets}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
