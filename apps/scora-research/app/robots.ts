import type { MetadataRoute } from "next";
import { SITIO } from "@/lib/sitio";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/stock/", "/watchlist", "/audit", "/discovery", "/auth/", "/account"] },
    sitemap: `${SITIO}/sitemap.xml`,
  };
}
