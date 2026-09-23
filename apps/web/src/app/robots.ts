import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard",
        "/guide",
        "/help",
        "/onboarding",
        "/organizations/",
        "/r/",
        "/sign-in",
        "/sites",
      ],
    },
    sitemap: "https://webprobe.fr/sitemap.xml",
  };
}
