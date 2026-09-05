import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/stock/", "/watchlist", "/audit", "/discovery", "/auth/"] },
    sitemap: "https://scora-research.vercel.app/sitemap.xml",
  };
}
