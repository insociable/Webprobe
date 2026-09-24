import type { ScanMode } from "./types.js";

export type DeepAuditAuthorization = Readonly<{
  siteId: string;
  proofType: "dns_txt";
  proofRecordName: string | null;
  proofTokenHash: string | null;
  generationId: string | null;
  proofVerifiedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revalidatedAt: Date | null;
}>;

export type AuthorizationDecision =
  | {
      allowed: true;
      level: "public" | "verified" | "deep";
      grantIdentity?: {
        generationId: string;
        tokenHash: string;
        verifiedAt: Date;
        canonicalUrl: string;
        siteVerifiedAt: Date;
      };
    }
  | {
      allowed: false;
      reason:
        | "site-inactive"
        | "site-unverified"
        | "deep-grant-missing"
        | "deep-grant-invalid"
        | "deep-grant-expired"
        | "deep-grant-revoked"
        | "unknown-mode";
    };

export function authorizeScan(input: {
  mode: ScanMode;
  siteId: string;
  siteStatus: "pending_verification" | "active" | "paused";
  verifiedAt: Date | null;
  deepGrant?: DeepAuditAuthorization | null;
  now: Date;
}): AuthorizationDecision {
  if (input.mode === "public_audit") {
    return input.siteStatus === "paused"
      ? { allowed: false, reason: "site-inactive" }
      : { allowed: true, level: "public" };
  }
  if (input.siteStatus !== "active") {
    return { allowed: false, reason: "site-inactive" };
  }
  if (!input.verifiedAt) {
    return { allowed: false, reason: "site-unverified" };
  }
  if (input.mode === "verified_monitoring") {
    return { allowed: true, level: "verified" };
  }
  if (input.mode !== "verified_deep_audit") {
    return { allowed: false, reason: "unknown-mode" };
  }
  const grant = input.deepGrant;
  if (!grant) return { allowed: false, reason: "deep-grant-missing" };
  if (grant.siteId !== input.siteId || grant.proofType !== "dns_txt") {
    return { allowed: false, reason: "deep-grant-invalid" };
  }
  if (grant.revokedAt) {
    return { allowed: false, reason: "deep-grant-revoked" };
  }
  if (
    !grant.generationId ||
    !grant.proofRecordName ||
    !/^[a-f0-9]{64}$/.test(grant.proofTokenHash ?? "") ||
    !Number.isFinite(grant.proofVerifiedAt.getTime()) ||
    !Number.isFinite(grant.expiresAt.getTime()) ||
    !grant.revalidatedAt ||
    !Number.isFinite(grant.revalidatedAt.getTime()) ||
    grant.proofVerifiedAt > input.now ||
    grant.revalidatedAt > input.now ||
    grant.revalidatedAt < grant.proofVerifiedAt ||
    input.now.getTime() - grant.revalidatedAt.getTime() > 5 * 60_000
  ) {
    return { allowed: false, reason: "deep-grant-invalid" };
  }
  if (grant.expiresAt <= input.now) {
    return { allowed: false, reason: "deep-grant-expired" };
  }
  return { allowed: true, level: "deep" };
}
