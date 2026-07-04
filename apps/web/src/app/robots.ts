import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/growth", "/login", "/onboarding", "/api/"],
      },
    ],
    sitemap: "https://growth.korrali.com/sitemap.xml",
  };
}
