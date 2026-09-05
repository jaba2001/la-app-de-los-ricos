"use client";
// Instrumentación de /daily. Va aparte porque la página es un server component y el
// tracking necesita el navegador.
//
// Sin esto no se puede medir lo único que importa de esta pieza: los visitantes
// RECURRENTES (≥3 días/semana). Ese número distingue hábito de curiosidad, y es la
// diferencia entre "publicamos un informe" y "la gente vuelve a por él".

import { useEffect } from "react";
import { track } from "@/lib/analytics";

export default function DailyTracker({
  date, isLatest, breadthKind, regimeChanged,
}: {
  date: string;
  isLatest: boolean;
  breadthKind: string | null;
  regimeChanged: boolean;
}) {
  useEffect(() => {
    // `is_latest` separa "vino a por el cierre de hoy" (hábito) de "estaba navegando el
    // archivo" (descubrimiento). Son dos comportamientos distintos y se miden distinto.
    track("daily_viewed", {
      date,
      is_latest: isLatest,
      breadth_kind: breadthKind,
      regime_changed: regimeChanged,
    });
  }, [date, isLatest, breadthKind, regimeChanged]);

  return null;
}
