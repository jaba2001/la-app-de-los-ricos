export function Sk({ w = "100%", h = 16, r = 6 }: { w?: string | number; h?: number; r?: number }) {
  return (
    <div
      className="skeleton"
      style={{ width: w, height: h, borderRadius: r }}
    />
  );
}

export function SkCard({ h = 80 }: { h?: number }) {
  return (
    <div className="card" style={{ height: h }}>
      <div className="skeleton" style={{ width: "40%", height: 12, borderRadius: 4, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: "60%", height: 28, borderRadius: 4 }} />
    </div>
  );
}
