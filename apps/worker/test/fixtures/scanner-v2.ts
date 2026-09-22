export const seoFixture = {
  complete: {
    title: "Agence Example — Création de sites",
    metaDescription: "Une description déterministe pour la fixture SEO.",
    canonicalHref: "/",
    robots: ["index, follow"],
    lang: "fr",
    h1Count: 1,
    internalLinkCount: 3,
    sitemapHrefs: ["/sitemap.xml"],
  },
  noindexMultipleH1: {
    title: "Page privée",
    metaDescription: null,
    canonicalHref: "https://example.com/private",
    robots: ["noindex, nofollow"],
    lang: "fr",
    h1Count: 2,
    internalLinkCount: 0,
    sitemapHrefs: [],
  },
  missingTitle: {
    title: null,
    metaDescription: null,
    canonicalHref: "::::",
    robots: [],
    lang: null,
    h1Count: 0,
    internalLinkCount: 0,
    sitemapHrefs: [],
  },
} as const;

export const robotsFixture = `
User-agent: *
Disallow: /private/
Allow: /public/
Sitemap: https://example.com/sitemap.xml
`;

export const sitemapFixture = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc><![CDATA[https://example.com/unvisited]]></loc></url>
</urlset>`;

export const networkFixture = {
  firstPartyScript404: "https://example.com/assets/app.js",
  firstPartyImage404: "https://example.com/images/logo.png",
  firstPartyStyleFailure: "https://example.com/assets/site.css",
  thirdPartyFailure: "https://cdn.example.net/widget.js",
};

export const crawlFixture = {
  root: "https://example.com/",
  redirected: "https://example.com/old",
  final: "https://example.com/new?variant=a",
  external: "https://outside.example/",
  thirdPage: "https://example.com/unvisited",
};
