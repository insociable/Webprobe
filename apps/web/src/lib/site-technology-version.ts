import { isSupportedVulnerabilityVersion } from "@agency-saas/contracts";
import {
  siteTechnologyVersions,
  technologyObservations,
} from "@agency-saas/db";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  getSiteForOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";

export class TechnologyVersionError extends Error {}

export async function setSiteTechnologyVersion(input: {
  userId: string;
  organizationId: string;
  siteId: string;
  observationId: string;
  version: string | null;
}): Promise<void> {
  const access = await requireOrganizationAccess(
    input.userId,
    input.organizationId,
  );
  if (!canManageOrganization(access.role)) {
    throw new OrganizationAccessError(
      "Only owners and admins can declare versions",
    );
  }
  const site = await getSiteForOrganization(
    input.userId,
    input.organizationId,
    input.siteId,
  );
  if (!site) throw new TechnologyVersionError("Site introuvable.");
  if (
    input.version !== null &&
    !isSupportedVulnerabilityVersion(input.version)
  ) {
    throw new TechnologyVersionError(
      "Renseignez une version exacte au format 2.4.65, sans suffixe ni plage de versions.",
    );
  }

  await db.transaction(async (tx) => {
    const [observation] = await tx
      .select()
      .from(technologyObservations)
      .where(
        and(
          eq(technologyObservations.id, input.observationId),
          eq(technologyObservations.organizationId, input.organizationId),
          eq(technologyObservations.siteId, input.siteId),
        ),
      )
      .limit(1);
    if (!observation)
      throw new TechnologyVersionError("Technologie introuvable.");
    const [latest] = await tx
      .select({ id: technologyObservations.id })
      .from(technologyObservations)
      .where(
        and(
          eq(technologyObservations.organizationId, input.organizationId),
          eq(technologyObservations.siteId, input.siteId),
          eq(technologyObservations.vendor, observation.vendor),
          eq(technologyObservations.product, observation.product),
        ),
      )
      .orderBy(
        desc(technologyObservations.observedAt),
        desc(technologyObservations.id),
      )
      .limit(1);
    if (latest?.id !== observation.id) {
      throw new TechnologyVersionError(
        "Un nouveau scan est disponible. Actualisez la page avant de renseigner la version.",
      );
    }

    if (input.version === null) {
      await tx
        .delete(siteTechnologyVersions)
        .where(
          and(
            eq(siteTechnologyVersions.organizationId, input.organizationId),
            eq(siteTechnologyVersions.siteId, input.siteId),
            eq(siteTechnologyVersions.observationId, observation.id),
          ),
        );
      return;
    }
    if (
      observation.versionConfidence === "exact" &&
      observation.version &&
      isSupportedVulnerabilityVersion(observation.version)
    ) {
      throw new TechnologyVersionError(
        "Une version exacte a déjà été observée par le scan.",
      );
    }
    await tx
      .insert(siteTechnologyVersions)
      .values({
        organizationId: input.organizationId,
        siteId: input.siteId,
        observationId: observation.id,
        version: input.version.trim(),
        declaredBy: input.userId,
        declaredAt: new Date(),
      })
      .onConflictDoUpdate({
        target: siteTechnologyVersions.observationId,
        set: {
          version: input.version.trim(),
          declaredBy: input.userId,
          declaredAt: new Date(),
        },
      });
  });
}
