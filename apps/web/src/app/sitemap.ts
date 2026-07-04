import type { MetadataRoute } from "next";

const BASE = "https://growth.korrali.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: BASE, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${BASE}/growth-service`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
  ];
}
