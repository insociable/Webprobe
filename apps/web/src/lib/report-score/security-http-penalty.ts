type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : null;
}

/**
 * Bounded score adjustment for weaknesses observed inside an otherwise present
 * CSP. Missing CSP remains represented by the normal finding pipeline, so this
 * function never duplicates the missing-header penalty.
 */
export function securityHttpConfigurationPenalty(summary: unknown): number {
  const http = record(record(summary)?.http);
  if (!http || !Array.isArray(http.securityHeaders)) return 0;

  const csp = http.securityHeaders
    .map(record)
    .find(
      (observation) =>
        observation?.name === "content-security-policy" &&
        observation.present === true &&
        typeof observation.value === "string",
    );

  if (!csp || typeof csp.value !== "string") return 0;

  const value = csp.value.toLowerCase();
  let penalty = 0;
  if (value.includes("'unsafe-inline'")) penalty += 4;
  if (value.includes("'unsafe-eval'")) penalty += 4;
  return Math.min(8, penalty);
}
