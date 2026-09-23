export type PublicAuditLogEvent =
  | {
      event: "queued";
      userId: string;
      organizationId: string;
      siteId: string;
      scanId: string;
      hostname: string;
    }
  | {
      event: "rejected";
      userId: string;
      organizationId: string;
      siteId: string;
      hostname?: string;
      reason: string;
    };

export function logPublicAuditEvent(event: PublicAuditLogEvent): void {
  console.info(
    JSON.stringify({
      scope: "public-audit",
      ...event,
    }),
  );
}
