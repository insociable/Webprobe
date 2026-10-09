import "server-only";

import {
  scans,
  sites,
  thirdPartyDecisions,
  thirdPartyObservations,
  thirdPartySnapshots,
} from "@agency-saas/db";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./database";
import {
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";
import { canManageOrganization } from "./organization-permissions";
import {
  fetchStackLegalProvider,
  isStackLegalProviderId,
  type StackLegalProvider,
  type StackLegalProviderId,
} from "./stacklegal";

export type ThirdPartyRow = {
  providerId: StackLegalProviderId;
  confidence: "high" | "medium" | null;
  evidence: string[];
  detectedAt: Date | null;
  status: "pending" | "confirmed" | "ignored";
  provider: StackLegalProvider | null;
};

async function requireSite(organizationId: string, siteId: string) {
  const rows = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]) throw new OrganizationAccessError("Site not found");
}

export async function getThirdPartyOverview(
  userId: string,
  organizationId: string,
  siteId: string,
) {
  await requireOrganizationAccess(userId, organizationId);
  await requireSite(organizationId, siteId);
  const [latest] = await db
    .select({ id: scans.id })
    .from(scans)
    .where(
      and(
        eq(scans.organizationId, organizationId),
        eq(scans.siteId, siteId),
        eq(scans.status, "completed"),
      ),
    )
    .orderBy(desc(scans.completedAt))
    .limit(1);
  const [observations, decisions] = await Promise.all([
    latest
      ? db
          .select()
          .from(thirdPartyObservations)
          .where(
            and(
              eq(thirdPartyObservations.organizationId, organizationId),
              eq(thirdPartyObservations.siteId, siteId),
              eq(thirdPartyObservations.scanId, latest.id),
            ),
          )
      : Promise.resolve([]),
    db
      .select({ decision: thirdPartyDecisions, snapshot: thirdPartySnapshots })
      .from(thirdPartyDecisions)
      .leftJoin(
        thirdPartySnapshots,
        and(
          eq(thirdPartyDecisions.snapshotId, thirdPartySnapshots.id),
          eq(thirdPartySnapshots.organizationId, organizationId),
          eq(thirdPartySnapshots.siteId, siteId),
        ),
      )
      .where(
        and(
          eq(thirdPartyDecisions.organizationId, organizationId),
          eq(thirdPartyDecisions.siteId, siteId),
        ),
      ),
  ]);
  const rows = new Map<StackLegalProviderId, ThirdPartyRow>();
  for (const observation of observations) {
    if (!isStackLegalProviderId(observation.providerId)) continue;
    rows.set(observation.providerId, {
      providerId: observation.providerId,
      confidence: observation.confidence === "high" ? "high" : "medium",
      evidence: Array.isArray(observation.evidence) ? observation.evidence : [],
      detectedAt: observation.detectedAt,
      status: "pending",
      provider: null,
    });
  }
  for (const item of decisions) {
    if (!isStackLegalProviderId(item.decision.providerId)) continue;
    const existing = rows.get(item.decision.providerId) ?? {
      providerId: item.decision.providerId,
      confidence: null,
      evidence: [],
      detectedAt: null,
      status: "pending" as const,
      provider: null,
    };
    const data = item.snapshot?.providerData;
    rows.set(item.decision.providerId, {
      ...existing,
      status: item.decision.status === "confirmed" ? "confirmed" : "ignored",
      provider:
        item.decision.status === "confirmed" &&
        data &&
        data.id === item.decision.providerId
          ? (data as StackLegalProvider)
          : null,
    });
  }
  return [...rows.values()];
}

export async function decideThirdParty(
  userId: string,
  organizationId: string,
  siteId: string,
  providerId: unknown,
  status: unknown,
): Promise<void> {
  if (
    !isStackLegalProviderId(providerId) ||
    (status !== "confirmed" && status !== "ignored")
  ) {
    throw new Error("Invalid third-party decision");
  }
  const access = await requireOrganizationAccess(userId, organizationId);
  if (!canManageOrganization(access.role)) throw new OrganizationAccessError();
  await requireSite(organizationId, siteId);
  const [observed] = await db
    .select({ id: thirdPartyObservations.id })
    .from(thirdPartyObservations)
    .where(
      and(
        eq(thirdPartyObservations.organizationId, organizationId),
        eq(thirdPartyObservations.siteId, siteId),
        eq(thirdPartyObservations.providerId, providerId),
      ),
    )
    .limit(1);
  if (!observed)
    throw new OrganizationAccessError("Service not observed on this site");

  const provider =
    status === "confirmed" ? await fetchStackLegalProvider(providerId) : null;
  await db.transaction(async (tx) => {
    const [site] = await tx
      .select({ id: sites.id })
      .from(sites)
      .where(
        and(eq(sites.id, siteId), eq(sites.organizationId, organizationId)),
      )
      .limit(1);
    if (!site) throw new OrganizationAccessError("Site not found");
    const [previous] = await tx
      .select({
        status: thirdPartyDecisions.status,
        snapshotId: thirdPartyDecisions.snapshotId,
      })
      .from(thirdPartyDecisions)
      .where(
        and(
          eq(thirdPartyDecisions.organizationId, organizationId),
          eq(thirdPartyDecisions.siteId, siteId),
          eq(thirdPartyDecisions.providerId, providerId),
        ),
      )
      .limit(1);
    let snapshotId: string | null =
      status === "confirmed" && !provider && previous?.status === "confirmed"
        ? previous.snapshotId
        : null;
    if (provider) {
      const [snapshot] = await tx
        .insert(thirdPartySnapshots)
        .values({
          organizationId,
          siteId,
          providerId,
          apiVersion: "1",
          providerData: provider,
          lastVerified: provider.lastVerified,
          fetchedAt: new Date(),
        })
        .returning({ id: thirdPartySnapshots.id });
      snapshotId = snapshot?.id ?? null;
    }
    await tx
      .insert(thirdPartyDecisions)
      .values({
        organizationId,
        siteId,
        providerId,
        status,
        snapshotId,
        decidedBy: userId,
        decidedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          thirdPartyDecisions.organizationId,
          thirdPartyDecisions.siteId,
          thirdPartyDecisions.providerId,
        ],
        set: { status, snapshotId, decidedBy: userId, decidedAt: new Date() },
      });
  });
}

export async function resetThirdPartyDecision(
  userId: string,
  organizationId: string,
  siteId: string,
  providerId: unknown,
): Promise<void> {
  if (!isStackLegalProviderId(providerId)) {
    throw new Error("Invalid third-party provider");
  }
  const access = await requireOrganizationAccess(userId, organizationId);
  if (!canManageOrganization(access.role)) throw new OrganizationAccessError();
  await requireSite(organizationId, siteId);
  await db
    .delete(thirdPartyDecisions)
    .where(
      and(
        eq(thirdPartyDecisions.organizationId, organizationId),
        eq(thirdPartyDecisions.siteId, siteId),
        eq(thirdPartyDecisions.providerId, providerId),
      ),
    );
}
