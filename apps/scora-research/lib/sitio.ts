// La dirección pública de la app, en UN solo sitio (AUDIT_REPORT B-4).
//
// Estaba escrita a mano como https://scora-research.vercel.app en cinco lugares —la URL
// canónica de cada página, el sitemap, robots.txt y las URL de vuelta de Stripe—, y ese era el
// despliegue de Vercel, no este. Los buscadores y las tarjetas al compartir enlazaban fuera, y
// un pago habría devuelto al usuario a otra web.
//
// Para cambiarla basta NEXT_PUBLIC_SITE_URL en infra/.env.gcp (se incrusta al construir la
// imagen, porque la usan páginas que se generan en el build). Sin ella, la de Cloud Run.
export const SITIO = (process.env.NEXT_PUBLIC_SITE_URL || "https://scora-628763661566.europe-west1.run.app")
  .replace(/\/+$/, "");
