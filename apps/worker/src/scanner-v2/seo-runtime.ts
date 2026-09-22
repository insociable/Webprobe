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
      const boundedValue = (value, limit) => {
        const raw = typeof value === "string" ? value : "";
        return { value: raw.slice(0, limit).trim() || null, truncated: raw.length > limit };
      };
      let contentTruncated = false;
      const readText = (selector) => {
        const value = boundedValue(document.querySelector(selector)?.textContent, 4096);
        contentTruncated ||= value.truncated;
        return value.value;
      };
      const readAttribute = (element, name, limit) => {
        const value = boundedValue(element?.getAttribute(name), limit);
        contentTruncated ||= value.truncated;
        return value.value;
      };
      const robots = [];
      const robotElements = document.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]');
      if (robotElements.length > 20) contentTruncated = true;
      for (let index = 0; index < Math.min(robotElements.length, 20); index += 1) {
        const value = readAttribute(robotElements[index], "content", 512);
        if (value) robots.push(value);
      }
      const sitemapHrefs = [];
      const linkElements = document.querySelectorAll('link[rel]');
      const sitemapLinkLimit = Math.min(linkElements.length, 200);
      if (linkElements.length > sitemapLinkLimit) contentTruncated = true;
      for (let index = 0; index < sitemapLinkLimit && sitemapHrefs.length < 20; index += 1) {
        const element = linkElements[index];
        if ((element.getAttribute("rel") || "").toLowerCase().split(/\\s+/).includes("sitemap")) {
          const value = readAttribute(element, "href", 2048);
          if (value) sitemapHrefs.push(value);
        }
      }
      if (sitemapHrefs.length === 20) contentTruncated = true;
      const anchors = document.querySelectorAll("a[href]");
      const anchorLimit = Math.min(anchors.length, 1000);
      if (anchors.length > anchorLimit) contentTruncated = true;
      let internalLinkCount = 0;
      for (let index = 0; index < anchorLimit; index += 1) {
        try {
          const rawHref = anchors[index].getAttribute("href") || "";
          if (rawHref.length > 2048) {
            contentTruncated = true;
            continue;
          }
          if (new URL(rawHref, location.href).origin === location.origin) {
            internalLinkCount += 1;
          }
        } catch { /* malformed href */ }
      }
      return {
        title: readText("title"),
        metaDescription: readAttribute(document.querySelector('meta[name="description" i]'), "content", 4096),
        canonicalHref: readAttribute(document.querySelector('link[rel="canonical" i]'), "href", 2048),
        robots,
        lang: readAttribute(document.documentElement, "lang", 100),
        h1Count: document.querySelectorAll("h1").length,
        internalLinkCount,
        sitemapHrefs,
        contentTruncated,
      };
    })()`);
  } catch {
    return null;
  }
}
