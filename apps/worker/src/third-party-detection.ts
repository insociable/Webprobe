export type ThirdPartyProviderId =
  | "cloudflare"
  | "stripe"
  | "google-analytics"
  | "plausible"
  | "sentry"
  | "posthog"
  | "intercom"
  | "hotjar"
  | "vercel";

export type ThirdPartyObservationInput = {
  providerId: ThirdPartyProviderId;
  confidence: "high" | "medium";
  evidence: string[];
};

const resourceRules: {
  id: ThirdPartyProviderId;
  matches: (url: URL) => boolean;
}[] = [
  {
    id: "stripe",
    matches: (url) =>
      url.hostname === "js.stripe.com" && url.pathname.startsWith("/v3"),
  },
  {
    id: "google-analytics",
    matches: (url) =>
      (url.hostname === "www.google-analytics.com" &&
        (url.pathname.startsWith("/g/collect") ||
          url.pathname.startsWith("/analytics.js"))) ||
      (url.hostname === "www.googletagmanager.com" &&
        url.pathname === "/gtag/js" &&
        /^G-[A-Z0-9]+$/i.test(url.searchParams.get("id") ?? "")),
  },
  {
    id: "plausible",
    matches: (url) =>
      url.hostname === "plausible.io" &&
      /^\/js\/script(?:\.[a-z]+)*\.js$/.test(url.pathname),
  },
  {
    id: "sentry",
    matches: (url) =>
      url.hostname === "browser.sentry-cdn.com" && url.pathname.endsWith(".js"),
  },
  {
    id: "posthog",
    matches: (url) =>
      [
        "us-assets.i.posthog.com",
        "eu-assets.i.posthog.com",
        "app.posthog.com",
      ].includes(url.hostname) && url.pathname.startsWith("/static/"),
  },
  {
    id: "intercom",
    matches: (url) =>
      (url.hostname === "widget.intercom.io" &&
        url.pathname.startsWith("/widget/")) ||
      (url.hostname === "js.intercomcdn.com" && url.pathname.endsWith(".js")),
  },
  {
    id: "hotjar",
    matches: (url) =>
      url.hostname === "static.hotjar.com" &&
      url.pathname.startsWith("/c/hotjar-"),
  },
];

function add(
  found: Map<ThirdPartyProviderId, ThirdPartyObservationInput>,
  providerId: ThirdPartyProviderId,
  evidence: string,
  confidence: "high" | "medium" = "high",
) {
  const existing = found.get(providerId);
  if (existing) {
    if (existing.evidence.length < 5 && !existing.evidence.includes(evidence)) {
      existing.evidence.push(evidence);
    }
    if (confidence === "high") existing.confidence = "high";
  } else {
    found.set(providerId, { providerId, confidence, evidence: [evidence] });
  }
}

export function detectThirdPartyServices(input: {
  headers?: Record<string, string | undefined>;
  resources?: string[];
}): ThirdPartyObservationInput[] {
  const found = new Map<ThirdPartyProviderId, ThirdPartyObservationInput>();
  const headers = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
  if (headers["cf-ray"]) add(found, "cloudflare", "Header CF-Ray observé");
  if (headers["cf-cache-status"])
    add(found, "cloudflare", "Header CF-Cache-Status observé");
  if (/^cloudflare(?:\s|$)/i.test(headers.server ?? "")) {
    add(found, "cloudflare", "Header Server: cloudflare", "medium");
  }
  if (headers["x-vercel-id"])
    add(found, "vercel", "Header X-Vercel-Id observé");

  for (const raw of (input.resources ?? []).slice(0, 500)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    for (const rule of resourceRules) {
      if (rule.matches(url)) {
        add(
          found,
          rule.id,
          `Ressource réseau : ${url.hostname}${url.pathname.slice(0, 100)}`,
        );
      }
    }
  }
  return [...found.values()];
}
