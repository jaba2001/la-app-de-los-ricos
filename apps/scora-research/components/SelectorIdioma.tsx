"use client";
// EN / ES. Guarda la elección en una cookie (un año) y recarga: la página entera se vuelve a
// pintar en el idioma nuevo, también lo que viene del servidor, sin mezclar idiomas.
import { useContext } from "react";
import { IdiomaContexto, t } from "@/lib/i18n/cliente";
import { COOKIE_IDIOMA, IDIOMAS, type Idioma } from "@/lib/i18n/traducir";

const NOMBRE: Record<Idioma, string> = { en: "EN", es: "ES" };
const TITULO: Record<Idioma, string> = { en: "English", es: "Español" };

// Fuera del componente: escribir en document no es estado de React.
function guardarYRecargar(i: Idioma) {
  document.cookie = `${COOKIE_IDIOMA}=${i}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

export default function SelectorIdioma({ compacto = false }: { compacto?: boolean }) {
  const actual = useContext(IdiomaContexto);
  function elegir(i: Idioma) {
    if (i !== actual) guardarYRecargar(i);
  }
  return (
    <div role="group" aria-label={t("Language")} style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
      {IDIOMAS.map((i) => (
        <button
          key={i}
          type="button"
          title={TITULO[i]}
          aria-pressed={i === actual}
          onClick={() => elegir(i)}
          style={{
            background: i === actual ? "var(--sr-surface-2)" : "transparent",
            border: "1px solid " + (i === actual ? "var(--sr-border-2, var(--sr-border))" : "transparent"),
            borderRadius: "var(--sr-radius-sm, 6px)",
            color: i === actual ? "var(--sr-text)" : "var(--sr-text-3)",
            fontWeight: i === actual ? 700 : 500,
            fontSize: compacto ? "11px" : "var(--sr-t-xs)",
            padding: compacto ? "2px 6px" : "4px 8px",
            cursor: i === actual ? "default" : "pointer",
          }}
        >
          {NOMBRE[i]}
        </button>
      ))}
    </div>
  );
}
