import type { MetadataRoute } from "next";
import { fetchDailyDates } from "@/lib/dailyClose";

// Public, indexable routes. Auth-gated app pages (stock, watchlist, audit) are excluded —
// they render behind login and carry no public content. The landing, pricing and the live
// track record are the public front door.

/** El sitemap se reconstruye a diario porque los cierres se publican a diario. */
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://scora-research.vercel.app";
  const now = new Date();

  const routes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/demo`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    // Publicado cada día de mercado tras el cierre US — la pieza de contenido recurrente.
    { url: `${base}/daily`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/track-record`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    // /picks es público y se actualiza dos veces al mes: es la pieza compartible del
    // producto, y la que un buscador debe poder indexar entera.
    { url: `${base}/picks`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    // El Libro de Evidencia: publica hasta las señales que fallaron. Es el activo que
    // ningún competidor puede copiar sin admitir lo mismo, así que es contenido, no solo UI.
    { url: `${base}/evidence`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
  ];

  // Cada cierre publicado es una URL propia y estable: es el archivo que se acumula día a
  // día, y la razón de tener `/daily/[date]` en vez de una sola página que se sobrescribe.
  // Si la base no responde, el sitemap sale con las rutas fijas en vez de fallar el build.
  try {
    const dates = await fetchDailyDates(180);
    for (const d of dates) {
      routes.push({
        url: `${base}/daily/${d}`,
        lastModified: new Date(`${d}T21:30:00Z`),
        // Un cierre pasado ya no cambia.
        changeFrequency: "never",
        priority: 0.6,
      });
    }
  } catch { /* rutas fijas y seguimos */ }

  return routes;
}
