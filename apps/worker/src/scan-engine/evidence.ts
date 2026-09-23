export type EvidenceClass =
  | "observation"
  | "active_safe"
  | "confirmed_risk"
  | "manual_confirmation";

export type CheckEvidence = Readonly<{
  checkId: string;
  checkVersion: string;
  classification: EvidenceClass;
  confidence: number;
  data: Record<string, unknown>;
}>;

const evidenceClasses = new Set<EvidenceClass>([
  "observation",
  "active_safe",
  "confirmed_risk",
  "manual_confirmation",
]);

export function createEvidence(value: CheckEvidence): CheckEvidence {
  if (!/^[a-z][a-z0-9-]{1,79}$/.test(value.checkId)) {
    throw new Error("Invalid check ID");
  }
  if (!/^\d+\.\d+\.\d+$/.test(value.checkVersion)) {
    throw new Error("Invalid check version");
  }
  if (!evidenceClasses.has(value.classification)) {
    throw new Error("Invalid evidence classification");
  }
  if (
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    throw new Error("Evidence confidence must be between zero and one");
  }
  if (
    !value.data ||
    Array.isArray(value.data) ||
    typeof value.data !== "object"
  ) {
    throw new Error("Evidence data must be structured");
  }
  return { ...value, data: { ...value.data } };
}
