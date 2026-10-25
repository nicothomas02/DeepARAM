import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/account", "/api/", "/data/"] },
    sitemap: "https://deeparam.com/sitemap.xml",
    host: "https://deeparam.com",
  };
}
