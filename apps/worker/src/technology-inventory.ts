export type TechnologyVersionConfidence = "exact" | "partial" | "unknown";
export type TechnologyDetectionConfidence = "high" | "medium";
export type TechnologyCategory =
  | "web_server"
  | "runtime"
  | "cdn"
  | "cms"
  | "framework"
  | "library";
export type TechnologyObservationSource = "http_header" | "browser_signature";

export type TechnologyObservationInput = {
  category: TechnologyCategory;
  vendor: string;
  product: string;
  version: string | null;
  versionConfidence: TechnologyVersionConfidence;
  detectionConfidence: TechnologyDetectionConfidence;
  source: TechnologyObservationSource;
  evidence: Record<string, unknown>;
};

export type TechnologyBrowserSignals = {
  resources?: ReadonlyArray<string>;
  meta?: ReadonlyArray<{ name: string; content: string }>;
};

export type TechnologyInventoryInput = {
  headers?: Readonly<Record<string, string>>;
  browser?: TechnologyBrowserSignals | null;
};

function versionFromHeaderToken(token: string | undefined): {
  version: string | null;
  confidence: TechnologyVersionConfidence;
} {
  if (!token) return { version: null, confidence: "unknown" };
  const normalized = token.trim();
  if (!/^\d+(?:\.\d+){0,3}$/.test(normalized)) {
    return { version: null, confidence: "unknown" };
  }
  return {
    version: normalized,
    confidence: normalized.split(".").length >= 3 ? "exact" : "partial",
  };
}

function versionFromGeneratorToken(token: string | undefined): {
  version: string | null;
  confidence: TechnologyVersionConfidence;
} {
  if (!token) return { version: null, confidence: "unknown" };
  const normalized = token.trim();
  if (!/^\d+(?:\.\d+){1,3}$/.test(normalized)) {
    return { version: null, confidence: "unknown" };
  }
  return { version: normalized, confidence: "exact" };
}

function httpObservation(
  category: TechnologyCategory,
  vendor: string,
  product: string,
  signature: string,
  versionToken: string | undefined,
  header: string,
): TechnologyObservationInput {
  const parsed = versionFromHeaderToken(versionToken);
  return {
    category,
    vendor,
    product,
    version: parsed.version,
    versionConfidence: parsed.confidence,
    detectionConfidence: "high",
    source: "http_header",
    evidence: {
      header,
      signature,
      ...(parsed.version ? { observedVersion: parsed.version } : {}),
    },
  };
}

function inventoryObservation(input: {
  category: TechnologyCategory;
  vendor: string;
  product: string;
  version?: string | null;
  versionConfidence?: TechnologyVersionConfidence;
  detectionConfidence: TechnologyDetectionConfidence;
  signals: string[];
}): TechnologyObservationInput {
  return {
    category: input.category,
    vendor: input.vendor,
    product: input.product,
    version: input.version ?? null,
    versionConfidence: input.versionConfidence ?? "unknown",
    detectionConfidence: input.detectionConfidence,
    source: "browser_signature",
    evidence: {
      signals: [...new Set(input.signals)].sort(),
    },
  };
}

function safePath(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return parsed.pathname.toLowerCase();
  } catch {
    return null;
  }
}

function generatorMeta(meta: TechnologyBrowserSignals["meta"]): string[] {
  return (meta ?? [])
    .filter((item) => item.name.trim().toLowerCase() === "generator")
    .map((item) => item.content.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function detectBrowserTechnologies(
  browser: TechnologyBrowserSignals | null | undefined,
): TechnologyObservationInput[] {
  if (!browser) return [];
  const paths = (browser.resources ?? [])
    .flatMap((resource) => {
      const path = safePath(resource);
      return path ? [path] : [];
    })
    .slice(0, 400);
  const generators = generatorMeta(browser.meta);
  const observations: TechnologyObservationInput[] = [];

  const wordpressGenerator = generators
    .map((value) => ({
      value,
      match: /^wordpress(?:\s+([0-9]+(?:\.[0-9]+){1,3}))?/i.exec(value),
    }))
    .find((item) => item.match);
  if (wordpressGenerator?.match) {
    const parsed = versionFromGeneratorToken(wordpressGenerator.match[1]);
    observations.push(
      inventoryObservation({
        category: "cms",
        vendor: "wordpress",
        product: "wordpress",
        version: parsed.version,
        versionConfidence: parsed.confidence,
        detectionConfidence: "high",
        signals: ["meta:generator:wordpress"],
      }),
    );
  } else {
    const wpContent = paths.some((path) => path.includes("/wp-content/"));
    const wpIncludes = paths.some((path) => path.includes("/wp-includes/"));
    if (wpContent && wpIncludes) {
      observations.push(
        inventoryObservation({
          category: "cms",
          vendor: "wordpress",
          product: "wordpress",
          detectionConfidence: "high",
          signals: ["resource:/wp-content/", "resource:/wp-includes/"],
        }),
      );
    }
  }

  const drupalGenerator = generators.find((value) =>
    /^drupal(?:\s|$)/i.test(value),
  );
  if (drupalGenerator) {
    const version = /^drupal\s+([0-9]+(?:\.[0-9]+){0,3})/i.exec(
      drupalGenerator,
    )?.[1];
    const parsed = versionFromHeaderToken(version);
    observations.push(
      inventoryObservation({
        category: "cms",
        vendor: "drupal",
        product: "drupal",
        version: parsed.version,
        versionConfidence: parsed.confidence,
        detectionConfidence: "high",
        signals: ["meta:generator:drupal"],
      }),
    );
  } else {
    const drupalSites = paths.some((path) => path.includes("/sites/default/"));
    const drupalCore = paths.some((path) => path.includes("/core/"));
    if (drupalSites && drupalCore) {
      observations.push(
        inventoryObservation({
          category: "cms",
          vendor: "drupal",
          product: "drupal",
          detectionConfidence: "medium",
          signals: ["resource:/sites/default/", "resource:/core/"],
        }),
      );
    }
  }

  const joomlaGenerator = generators.find((value) =>
    /^joomla!?\b/i.test(value),
  );
  if (joomlaGenerator) {
    const version = /^joomla!?\s+([0-9]+(?:\.[0-9]+){1,3})/i.exec(
      joomlaGenerator,
    )?.[1];
    const parsed = versionFromGeneratorToken(version);
    observations.push(
      inventoryObservation({
        category: "cms",
        vendor: "joomla",
        product: "joomla",
        version: parsed.version,
        versionConfidence: parsed.confidence,
        detectionConfidence: "high",
        signals: ["meta:generator:joomla"],
      }),
    );
  } else {
    const joomlaSystem = paths.some((path) => path.includes("/media/system/"));
    const joomlaTemplate = paths.some(
      (path) => path.includes("/templates/") || path.includes("/media/vendor/"),
    );
    if (joomlaSystem && joomlaTemplate) {
      observations.push(
        inventoryObservation({
          category: "cms",
          vendor: "joomla",
          product: "joomla",
          detectionConfidence: "medium",
          signals: ["resource:/media/system/", "resource:joomla-secondary"],
        }),
      );
    }
  }

  const nextResources = paths.filter((path) => path.includes("/_next/static/"));
  if (new Set(nextResources).size >= 2) {
    observations.push(
      inventoryObservation({
        category: "framework",
        vendor: "vercel",
        product: "next.js",
        detectionConfidence: "high",
        signals: ["resource:/_next/static/", "resource:multiple-next-assets"],
      }),
    );
  }

  return observations;
}

function detectHttpTechnologies(
  headers: Readonly<Record<string, string>>,
): TechnologyObservationInput[] {
  const server = headers.server?.trim() ?? "";
  const poweredBy = headers["x-powered-by"]?.trim() ?? "";
  const observations: TechnologyObservationInput[] = [];

  const nginx = /^nginx(?:\/([^\s(]+))?(?:\s|$|\()/i.exec(server);
  if (nginx) {
    observations.push(
      httpObservation(
        "web_server",
        "nginx",
        "nginx",
        "nginx",
        nginx[1],
        "server",
      ),
    );
  }

  const apache = /^Apache(?:\/([^\s(]+))?(?:\s|$|\()/i.exec(server);
  if (apache) {
    observations.push(
      httpObservation(
        "web_server",
        "apache",
        "http_server",
        "apache",
        apache[1],
        "server",
      ),
    );
  }

  const php = /^PHP(?:\/([^\s(]+))?(?:\s|$|\()/i.exec(poweredBy);
  if (php) {
    observations.push(
      httpObservation("runtime", "php", "php", "php", php[1], "x-powered-by"),
    );
  }

  if (
    /^cloudflare(?:\s|$|\/)/i.test(server) ||
    Boolean(headers["cf-ray"]?.trim())
  ) {
    observations.push({
      category: "cdn",
      vendor: "cloudflare",
      product: "cloudflare",
      version: null,
      versionConfidence: "unknown",
      detectionConfidence: "high",
      source: "http_header",
      evidence: {
        signatures: [
          ...(/^cloudflare(?:\s|$|\/)/i.test(server)
            ? ["server:cloudflare"]
            : []),
          ...(headers["cf-ray"]?.trim() ? ["header:cf-ray"] : []),
        ],
      },
    });
  }

  if (/^express(?:\s|$|\/)/i.test(poweredBy)) {
    observations.push({
      category: "framework",
      vendor: "expressjs",
      product: "express",
      version: null,
      versionConfidence: "unknown",
      detectionConfidence: "high",
      source: "http_header",
      evidence: { header: "x-powered-by", signature: "express" },
    });
  }

  return observations;
}

function observationKey(observation: TechnologyObservationInput): string {
  return [observation.vendor, observation.product, observation.source].join(
    "\u0000",
  );
}

export function detectTechnologyInventory(
  input: TechnologyInventoryInput,
): TechnologyObservationInput[] {
  const candidates = [
    ...detectHttpTechnologies(input.headers ?? {}),
    ...detectBrowserTechnologies(input.browser),
  ];
  const byKey = new Map<string, TechnologyObservationInput>();
  for (const candidate of candidates) {
    const key = observationKey(candidate);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    if (
      existing.versionConfidence !== "exact" &&
      candidate.versionConfidence === "exact"
    ) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}

export function detectTechnologyObservations(
  headers: Record<string, string>,
): TechnologyObservationInput[] {
  return detectTechnologyInventory({ headers });
}
