import type { Page } from "playwright";
import type { SeoDocumentFacts } from "./seo.js";

type PageWithEvaluate = Page & {
  evaluate?: <T>(expression: string) => Promise<T>;
};

export async function extractSeoDocumentFacts(
  page: Page,
): Promise<SeoDocumentFacts | null> {
  const compatiblePage = page as PageWithEvaluate;
  if (!compatiblePage.evaluate) {
    return null;
  }

  try {
    return await compatiblePage.evaluate<SeoDocumentFacts>(`(() => {
      const text = (selector) => document.querySelector(selector)?.textContent?.trim() || null;
      const attribute = (selector, name) => document.querySelector(selector)?.getAttribute(name)?.trim() || null;
      const robots = Array.from(document.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]'))
        .map((element) => element.getAttribute("content") || "")
        .filter(Boolean);
      const sitemapHrefs = Array.from(document.querySelectorAll('link[rel]'))
        .filter((element) => (element.getAttribute("rel") || "").toLowerCase().split(/\\s+/).includes("sitemap"))
        .map((element) => element.getAttribute("href") || "")
        .filter(Boolean);
      const internalLinkCount = Array.from(document.querySelectorAll("a[href]"))
        .filter((element) => {
          try { return new URL(element.getAttribute("href") || "", location.href).origin === location.origin; }
          catch { return false; }
        }).length;
      return {
        title: text("title"),
        metaDescription: attribute('meta[name="description" i]', "content"),
        canonicalHref: attribute('link[rel="canonical" i]', "href"),
        robots,
        lang: document.documentElement.getAttribute("lang")?.trim() || null,
        h1Count: document.querySelectorAll("h1").length,
        internalLinkCount,
        sitemapHrefs,
      };
    })()`);
  } catch {
    return null;
  }
}
