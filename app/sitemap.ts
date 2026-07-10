import type { MetadataRoute } from "next";

// Public, indexable routes. Auth-gated app pages (stock, watchlist, audit) are excluded —
// they render behind login and carry no public content. The landing, pricing and the live
// track record are the public front door.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://scora-research.vercel.app";
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/track-record`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
  ];
}
