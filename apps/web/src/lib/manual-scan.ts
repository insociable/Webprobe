import { ScanJobSchema } from "@agency-saas/contracts";
import { scans } from "@agency-saas/db";
import { and, eq } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  getSiteForOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";
import { enqueueScanJob, type ScanEnqueuer } from "./scan-queue";
import { hasPostgresErrorCode } from "./postgres-error";

export class ManualScanError extends Error {
  constructor(
    message: string,
    readonly code:
      | "site-not-found"
      | "site-not-active"
      | "scan-already-running"
      | "queue-unavailable",
  ) {
    super(message);
    this.name = "ManualScanError";
  }
}

export async function createManualScanForSite(
  userId: string,
  organizationId: string,
  siteId: string,
  enqueue: ScanEnqueuer = enqueueScanJob,
) {
  const access = await requireOrganizationAccess(userId, organizationId);
  if (!canManageOrganization(access.role)) {
    throw new OrganizationAccessError(
      "Only organization owners and admins can start scans",
    );
  }

  const site = await getSiteForOrganization(userId, organizationId, siteId);
  if (!site) {
    throw new ManualScanError("Site not found", "site-not-found");
  }
  if (site.status !== "active" || !site.verifiedAt) {
    throw new ManualScanError(
      "Site must be verified and active before scanning",
      "site-not-active",
    );
  }

  let scan;
  try {
    [scan] = await db
      .insert(scans)
      .values({
        organizationId,
        siteId,
        status: "queued",
        trigger: "manual",
      })
      .returning();
  } catch (error) {
    if (hasPostgresErrorCode(error, "23505")) {
      throw new ManualScanError(
        "A scan is already queued or running for this site",
        "scan-already-running",
      );
    }
    throw error;
  }

  if (!scan) {
    throw new Error("Scan creation failed");
  }

  const payload = ScanJobSchema.parse({
    scanId: scan.id,
    organizationId,
    siteId,
    targetUrl: site.canonicalUrl,
  });

  try {
    await enqueue(payload);
  } catch {
    const current = await db
      .select({ status: scans.status })
      .from(scans)
      .where(
        and(
          eq(scans.id, scan.id),
          eq(scans.organizationId, organizationId),
          eq(scans.siteId, siteId),
        ),
      )
      .limit(1);

    if (current[0]?.status === "queued") {
      await db
        .delete(scans)
        .where(and(eq(scans.id, scan.id), eq(scans.status, "queued")));

      throw new ManualScanError(
        "Scan queue is unavailable",
        "queue-unavailable",
      );
    }

    if (
      current[0]?.status === "running" ||
      current[0]?.status === "completed"
    ) {
      return scan;
    }

    throw new ManualScanError("Scan queue is unavailable", "queue-unavailable");
  }

  return scan;
}
