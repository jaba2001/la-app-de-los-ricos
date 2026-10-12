
import { tv } from "@/lib/i18n/cliente";

export function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className="pill" style={{
      background: `color-mix(in srgb, ${color} 15%, transparent)`,
      color,
      border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
    }}>
      {tv(label)}
    </span>
  );
}
