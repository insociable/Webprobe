import {
  collectCspPolicies,
  redactCspNonceSources,
  type HttpProbeSuccess,
} from "../http-probe.js";

export type CspDirectives = Record<string, string[]>;

export function parseCsp(policy: string): CspDirectives {
  const directives: CspDirectives = Object.create(null) as CspDirectives;
  for (const clause of policy.slice(0, 8192).split(";").slice(0, 80)) {
    const tokens = clause.trim().split(/\s+/).filter(Boolean);
    const name = tokens.shift()?.toLowerCase();
    // A repeated directive is ignored by browsers within one policy.
    if (
      name &&
      /^[a-z][a-z0-9-]*$/.test(name) &&
      !Object.hasOwn(directives, name)
    ) {
      directives[name] = tokens.slice(0, 40).map((token) => {
        const redacted = redactCspNonceSources(token);
        if (
          /^'(?:self|none|unsafe-inline|unsafe-eval|strict-dynamic|unsafe-hashes|report-sample)'$/i.test(
            redacted,
          ) ||
          /^[a-z][a-z0-9+.-]*:$/i.test(redacted)
        )
          return redacted.toLowerCase();
        return redacted.replace(/[?#].*$/, "");
      });
    }
  }
  return directives;
}

export function observedCspPolicies(http: HttpProbeSuccess): {
  enforced: CspDirectives[];
  reportOnly: CspDirectives[];
  limited: boolean;
} {
  const original = http.cspPolicies;
  const collected = original
    ? collectCspPolicies({}, [
        ...original.enforced
          .slice(0, 4)
          .flatMap((value) => ["content-security-policy", value]),
        ...original.reportOnly
          .slice(0, 4)
          .flatMap((value) => ["content-security-policy-report-only", value]),
      ])
    : collectCspPolicies(http.headers);
  const enforced = collected.enforced;
  const reportOnly = collected.reportOnly;
  return {
    enforced: enforced.map(parseCsp),
    reportOnly: reportOnly.map(parseCsp),
    limited:
      collected.limited ||
      (original?.limited ?? false) ||
      (original !== undefined &&
        (original.enforced.length > 4 || original.reportOnly.length > 4)) ||
      [...enforced, ...reportOnly].some(
        (policy) =>
          policy.length >= 8192 ||
          policy.split(";").length > 80 ||
          policy
            .split(";")
            .some((clause) => clause.trim().split(/\s+/).length > 41),
      ),
  };
}

export function effectiveDirective(
  policy: CspDirectives,
  ...names: string[]
): string[] | null {
  for (const name of names) {
    if (Object.hasOwn(policy, name)) return policy[name] ?? [];
  }
  return null;
}

export function hasNonceOrHash(sources: readonly string[]): boolean {
  return sources.some((item) =>
    /^'(?:nonce-|sha(?:256|384|512)-)[A-Za-z0-9+/_-]+={0,2}'$/i.test(item),
  );
}

/** A nonce/hash disables unsafe-inline in current CSP implementations. */
export function allowsArbitraryInline(
  sources: readonly string[] | null,
): boolean {
  return (
    !!sources?.includes("'unsafe-inline'") &&
    !sources.includes("'strict-dynamic'") &&
    !hasNonceOrHash(sources)
  );
}

export function restrictsFraming(policy: CspDirectives): boolean {
  const sources = effectiveDirective(policy, "frame-ancestors");
  if (!sources) return false;
  if (sources.length === 0) return true;
  if (
    sources.includes("*") ||
    sources.some(
      (item) => item === "https:" || item === "http:" || item.startsWith("*:"),
    )
  )
    return false;
  if (sources.length === 1 && sources[0] === "'none'") return true;
  // 'none' is ignored when combined with another source.
  return sources
    .filter((item) => item !== "'none'")
    .every((item) => item === "'self'" || /^https?:\/\/[^*\s]+$/i.test(item));
}

const knownReferrerPolicies = new Set([
  "no-referrer",
  "no-referrer-when-downgrade",
  "origin",
  "origin-when-cross-origin",
  "same-origin",
  "strict-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url",
]);

export function effectiveReferrerPolicy(value: string): string | null {
  let effective: string | null = null;
  for (const candidate of value.slice(0, 8192).split(",")) {
    const token = candidate.trim().toLowerCase();
    if (knownReferrerPolicies.has(token)) effective = token;
  }
  return effective;
}

export function wildcardPermissions(value: string): string[] {
  const features = new Set<string>();
  const pattern =
    /(?:^|,)\s*([a-z][a-z0-9-]*)\s*=\s*(?:\(\s*\*\s*\)|\*)(?=\s*(?:,|$))/gi;
  for (const match of value.slice(0, 8192).matchAll(pattern)) {
    features.add(match[1]!.toLowerCase());
    if (features.size >= 12) break;
  }
  return [...features];
}
