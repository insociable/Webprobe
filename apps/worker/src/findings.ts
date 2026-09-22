import { createHash } from "node:crypto";
import type { FindingCategory, Severity } from "@agency-saas/contracts";
import type { HttpProbeResult } from "./http-probe.js";

export type GeneratedFinding = {
  category: FindingCategory;
  severity: Severity;
  code: string;
  title: string;
  pageUrl: string;
  fingerprint: string;
  evidence: Record<string, unknown>;
};

function fingerprint(
  category: FindingCategory,
  code: string,
  pageUrl: string,
): string {
  return createHash("sha256")
    .update(`${category}:${code}:${pageUrl}`)
    .digest("hex");
}

function finding(
  input: Omit<GeneratedFinding, "fingerprint">,
): GeneratedFinding {
  return {
    ...input,
    fingerprint: fingerprint(input.category, input.code, input.pageUrl),
  };
}

const securityHeaderMetadata: Record<
  string,
  { severity: Severity; code: string; title: string }
> = {
  "content-security-policy": {
    severity: "medium",
    code: "security-header.csp.missing",
    title: "Content-Security-Policy absent",
  },
  "strict-transport-security": {
    severity: "medium",
    code: "security-header.hsts.missing",
    title: "HSTS absent sur HTTPS",
  },
  "x-content-type-options": {
    severity: "low",
    code: "security-header.x-content-type-options.missing",
    title: "X-Content-Type-Options absent",
  },
  "referrer-policy": {
    severity: "low",
    code: "security-header.referrer-policy.missing",
    title: "Referrer-Policy absent",
  },
  "permissions-policy": {
    severity: "low",
    code: "security-header.permissions-policy.missing",
    title: "Permissions-Policy absent",
  },
  "x-frame-options": {
    severity: "low",
    code: "security-header.x-frame-options.missing",
    title: "Protection anti-framing non détectée",
  },
};
function availabilityFindings(
  probe: HttpProbeResult,
  targetUrl: string,
): GeneratedFinding[] {
  if (!probe.ok) {
    if (probe.error.kind === "tls") {
      return [
        finding({
          category: "tls",
          severity: "high",
          code: "tls.connection-failed",
          title: "Échec de validation TLS",
          pageUrl: probe.targetUrl,
          evidence: { errorCode: probe.error.code },
        }),
      ];
    }

    if (probe.error.kind === "redirect") {
      return [
        finding({
          category: "availability",
          severity: "medium",
          code: "availability.redirect-error",
          title: "Chaîne de redirection invalide",
          pageUrl: probe.targetUrl,
          evidence: { errorCode: probe.error.code },
        }),
      ];
    }

    return [
      finding({
        category: "availability",
        severity: "high",
        code:
          probe.error.kind === "timeout"
            ? "availability.timeout"
            : "availability.network-error",
        title:
          probe.error.kind === "timeout"
            ? "Le site ne répond pas dans le délai prévu"
            : "Le site est inaccessible",
        pageUrl: probe.targetUrl || targetUrl,
        evidence: {
          kind: probe.error.kind,
          errorCode: probe.error.code,
        },
      }),
    ];
  }

  if (probe.statusCode >= 500) {
    return [
      finding({
        category: "availability",
        severity: "high",
        code: "availability.http-5xx",
        title: "Le site retourne une erreur serveur",
        pageUrl: probe.finalUrl,
        evidence: { statusCode: probe.statusCode },
      }),
    ];
  }

  if (probe.statusCode >= 400) {
    return [
      finding({
        category: "availability",
        severity: "medium",
        code: "availability.http-4xx",
        title: "Le site retourne une erreur HTTP",
        pageUrl: probe.finalUrl,
        evidence: { statusCode: probe.statusCode },
      }),
    ];
  }

  if (probe.statusCode >= 300) {
    return [
      finding({
        category: "availability",
        severity: "low",
        code: "availability.http-3xx-final",
        title: "La destination finale reste une redirection",
        pageUrl: probe.finalUrl,
        evidence: { statusCode: probe.statusCode },
      }),
    ];
  }

  return [];
}
function securityHeaderFindings(
  probe: Extract<HttpProbeResult, { ok: true }>,
): GeneratedFinding[] {
  const findings: GeneratedFinding[] = [];

  for (const observation of probe.securityHeaders) {
    if (!observation.expected || observation.present) {
      continue;
    }

    if (
      observation.name === "x-frame-options" &&
      probe.headers["content-security-policy"]
        ?.toLowerCase()
        .includes("frame-ancestors")
    ) {
      continue;
    }

    const metadata = securityHeaderMetadata[observation.name];
    if (!metadata) {
      continue;
    }

    findings.push(
      finding({
        category: "security-header",
        severity: metadata.severity,
        code: metadata.code,
        title: metadata.title,
        pageUrl: probe.finalUrl,
        evidence: { header: observation.name },
      }),
    );
  }

  const poweredBy = probe.headers["x-powered-by"];
  if (poweredBy) {
    findings.push(
      finding({
        category: "security-header",
        severity: "info",
        code: "security-header.x-powered-by.exposed",
        title: "Technologie exposée via X-Powered-By",
        pageUrl: probe.finalUrl,
        evidence: { value: poweredBy },
      }),
    );
  }

  return findings;
}

function tlsExpiryFindings(
  probe: Extract<HttpProbeResult, { ok: true }>,
  now: Date,
): GeneratedFinding[] {
  if (!probe.tls?.validTo) {
    return [];
  }

  const expiresAt = Date.parse(probe.tls.validTo);
  if (!Number.isFinite(expiresAt)) {
    return [];
  }

  const remainingDays = Math.ceil(
    (expiresAt - now.getTime()) / (24 * 60 * 60 * 1000),
  );

  let severity: Severity | null = null;
  if (remainingDays <= 14) {
    severity = "high";
  } else if (remainingDays <= 30) {
    severity = "medium";
  } else if (remainingDays <= 60) {
    severity = "low";
  }

  if (!severity) {
    return [];
  }

  return [
    finding({
      category: "tls",
      severity,
      code: "tls.certificate-expiring",
      title: "Le certificat TLS expire bientôt",
      pageUrl: probe.finalUrl,
      evidence: {
        validTo: probe.tls.validTo,
        remainingDays,
        protocol: probe.tls.protocol,
      },
    }),
  ];
}
function performanceFindings(
  probe: Extract<HttpProbeResult, { ok: true }>,
): GeneratedFinding[] {
  if (probe.durationMs <= 2_000) {
    return [];
  }

  const severity: Severity = probe.durationMs > 5_000 ? "medium" : "low";

  return [
    finding({
      category: "performance",
      severity,
      code: "performance.http-response-slow",
      title: "Réponse HTTP lente",
      pageUrl: probe.finalUrl,
      evidence: { durationMs: probe.durationMs },
    }),
  ];
}

export function generateHttpProbeFindings(
  probe: HttpProbeResult,
  targetUrl: string,
  now = new Date(),
): GeneratedFinding[] {
  const findings = availabilityFindings(probe, targetUrl);

  if (!probe.ok) {
    return findings;
  }

  return [
    ...findings,
    ...securityHeaderFindings(probe),
    ...tlsExpiryFindings(probe, now),
    ...performanceFindings(probe),
  ];
}
