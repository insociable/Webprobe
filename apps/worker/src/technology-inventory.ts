export type TechnologyVersionConfidence = "exact" | "partial" | "unknown";
export type TechnologyDetectionConfidence = "high" | "medium";

export type TechnologyObservationInput = {
  category: "web_server" | "runtime";
  vendor: string;
  product: string;
  version: string | null;
  versionConfidence: TechnologyVersionConfidence;
  detectionConfidence: TechnologyDetectionConfidence;
  source: "http_header";
  evidence: Record<string, unknown>;
};

function versionFromToken(token: string | undefined): {
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
    confidence: normalized.split(".").length === 3 ? "exact" : "partial",
  };
}

function observation(
  category: TechnologyObservationInput["category"],
  vendor: string,
  product: string,
  signature: string,
  versionToken: string | undefined,
  header: string,
): TechnologyObservationInput {
  const parsed = versionFromToken(versionToken);
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

export function detectTechnologyObservations(
  headers: Record<string, string>,
): TechnologyObservationInput[] {
  const server = headers.server?.trim() ?? "";
  const poweredBy = headers["x-powered-by"]?.trim() ?? "";
  const observations: TechnologyObservationInput[] = [];

  const nginx = /^nginx(?:\/([^\s(]+))?(?:\s|$|\()/i.exec(server);
  if (nginx) {
    observations.push(
      observation("web_server", "nginx", "nginx", "nginx", nginx[1], "server"),
    );
  }

  const apache = /^Apache(?:\/([^\s(]+))?(?:\s|$|\()/i.exec(server);
  if (apache) {
    observations.push(
      observation(
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
      observation("runtime", "php", "php", "php", php[1], "x-powered-by"),
    );
  }

  return observations;
}
