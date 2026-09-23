type UnknownRecord = Record<string, unknown>;

export type SecurityHttpControlStatus =
  | "pass"
  | "warning"
  | "fail"
  | "not-applicable";

export type SecurityHttpControl = {
  name: string;
  label: string;
  status: SecurityHttpControlStatus;
  value: string | null;
  notes: string[];
};

const labels: Record<string, string> = {
  "content-security-policy": "Content-Security-Policy",
  "strict-transport-security": "HSTS",
  "x-content-type-options": "X-Content-Type-Options",
  "referrer-policy": "Referrer-Policy",
  "permissions-policy": "Permissions-Policy",
  "x-frame-options": "Protection anti-framing",
};

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function getSecurityHttpControls(
  summary: unknown,
): SecurityHttpControl[] {
  const root = record(summary);
  const http = record(root?.http);
  if (!http || !Array.isArray(http.securityHeaders)) return [];

  const observations = new Map<
    string,
    { expected: boolean; present: boolean; value: string | null }
  >();

  for (const raw of http.securityHeaders) {
    const observation = record(raw);
    const name = stringOrNull(observation?.name)?.toLowerCase();
    if (!name || !(name in labels)) continue;

    observations.set(name, {
      expected: observation?.expected === true,
      present: observation?.present === true,
      value: stringOrNull(observation?.value),
    });
  }

  const csp = observations.get("content-security-policy");
  const cspValue = csp?.value?.toLowerCase() ?? "";
  const hasFrameAncestors = cspValue.includes("frame-ancestors");

  const controls: SecurityHttpControl[] = [];

  for (const name of Object.keys(labels)) {
    const observation = observations.get(name);
    if (!observation) continue;

    if (!observation.expected) {
      controls.push({
        name,
        label: labels[name]!,
        status: "not-applicable",
        value: observation.value,
        notes: ["Contrôle non applicable à cette réponse."],
      });
      continue;
    }

    if (
      name === "x-frame-options" &&
      !observation.present &&
      hasFrameAncestors
    ) {
      controls.push({
        name,
        label: labels[name]!,
        status: "pass",
        value: null,
        notes: [
          "Protection équivalente observée via la directive CSP frame-ancestors.",
        ],
      });
      continue;
    }

    if (!observation.present) {
      controls.push({
        name,
        label: labels[name]!,
        status: "fail",
        value: null,
        notes: ["Header attendu mais non observé."],
      });
      continue;
    }

    if (name === "content-security-policy" && observation.value) {
      const notes: string[] = [];
      if (cspValue.includes("'unsafe-inline'")) {
        notes.push("La directive unsafe-inline réduit la protection CSP.");
      }
      if (cspValue.includes("'unsafe-eval'")) {
        notes.push("La directive unsafe-eval réduit la protection CSP.");
      }

      if (notes.length > 0) {
        controls.push({
          name,
          label: labels[name]!,
          status: "warning",
          value: observation.value,
          notes,
        });
        continue;
      }
    }

    controls.push({
      name,
      label: labels[name]!,
      status: "pass",
      value: observation.value,
      notes: [],
    });
  }

  return controls;
}
