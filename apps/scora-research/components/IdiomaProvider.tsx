"use client";
// Fija el idioma para toda la app de cliente. Lo recibe del layout (servidor), que lo saca de
// la cookie o del navegador: así el primer HTML ya sale en el idioma bueno, sin parpadeo.
import { IdiomaContexto, fijarIdiomaCliente } from "@/lib/i18n/cliente";
import type { Idioma } from "@/lib/i18n/traducir";

export default function IdiomaProvider({ idioma, children }: { idioma: Idioma; children: React.ReactNode }) {
  // En el render, no en un efecto: los hijos se pintan después y tienen que verlo ya.
  if (typeof window !== "undefined") fijarIdiomaCliente(idioma);
  return <IdiomaContexto.Provider value={idioma}>{children}</IdiomaContexto.Provider>;
}
