// Aviso de que un dato NO se pudo leer o guardar (AUDIT_REPORT M-3).
//
// Existe porque 27 consultas trataban un error igual que "no hay filas": la watchlist salía
// vacía, un análisis parecía guardado sin estarlo, o un valor desaparecía de la lista aunque
// el borrado hubiera fallado. Un estado de error es preferible a un dato falso, y un mismo
// componente para todos evita que cada pantalla lo cuente a su manera.
export default function DataError({ mensaje, onCerrar }: { mensaje: string | null | undefined; onCerrar?: () => void }) {
  if (!mensaje) return null;
  return (
    <div role="alert" style={{
      display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", justifyContent: "space-between",
      border: "1px solid color-mix(in srgb, var(--sr-neg) 40%, var(--sr-border))",
      background: "color-mix(in srgb, var(--sr-neg) 8%, transparent)",
      borderRadius: "var(--sr-radius)", padding: "8px 12px", margin: "var(--sr-sp-3) 0",
      fontSize: "var(--sr-t-sm)", color: "var(--sr-text)",
    }}>
      <span>{mensaje}</span>
      {onCerrar && (
        <button onClick={onCerrar} aria-label="Dismiss" style={{ background: "none", border: "none", color: "var(--sr-text-2)", cursor: "pointer", fontSize: "var(--sr-t-base)" }}>×</button>
      )}
    </div>
  );
}

/** Los textos, para que todas las pantallas digan lo mismo. */
export const NO_SE_PUDO_CARGAR = "Couldn't load this data. It's not empty — the request failed. Try reloading.";
export const NO_SE_PUDO_GUARDAR = "Couldn't save that change. Nothing was changed — please try again.";
