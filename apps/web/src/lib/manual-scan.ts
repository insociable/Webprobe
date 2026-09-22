import { scanDispatches, scans } from "@agency-saas/db";
import { db } from "./database";
import {
  canManageOrganization,
  getSiteForOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";
import { hasPostgresErrorCode } from "./postgres-error";

export class ManualScanError extends Error {
  constructor(
    message: string,
    readonly code:
      | "site-not-found"
      | "site-not-active"
      | "scan-already-running",
  ) {
    super(message);
    this.name = "ManualScanError";
  }
}

export async function createManualScanForSite(
  userId: string,
  organizationId: string,
  siteId: string,
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
    scan = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(scans)
        .values({
          organizationId,
          siteId,
          status: "queued",
          trigger: "manual",
        })
        .returning();

      if (!created) {
        throw new Error("Scan creation failed");
      }

      await tx.insert(scanDispatches).values({ scanId: created.id });
      return created;
    });
  } catch (error) {
    if (hasPostgresErrorCode(error, "23505")) {
      throw new ManualScanError(
        "A scan is already queued or running for this site",
        "scan-already-running",
      );
    }
    throw error;
  }

  return scan;
}
