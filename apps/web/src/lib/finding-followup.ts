import {
  findingRemediationEvents,
  findingRemediations,
  findings,
  memberships,
  scans,
  users,
} from "@agency-saas/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";

export const followupStatuses = [
  "todo",
  "in_progress",
  "to_verify",
  "fixed",
  "accepted",
] as const;
export type FollowupStatus = (typeof followupStatuses)[number];

export async function getFindingFollowups(
  userId: string,
  organizationId: string,
  siteId: string,
  scanMode: "public_audit" | "verified_monitoring" | "verified_deep_audit",
  fingerprints: string[],
) {
  const access = await requireOrganizationAccess(userId, organizationId);
  const rows =
    fingerprints.length === 0
      ? []
      : await db
          .select()
          .from(findingRemediations)
          .where(
            and(
              eq(findingRemediations.organizationId, organizationId),
              eq(findingRemediations.siteId, siteId),
              eq(findingRemediations.scanMode, scanMode),
              inArray(findingRemediations.fingerprint, fingerprints),
            ),
          );
  const members = await db
    .select({
      id: users.id,
      name: users.displayName,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.organizationId, organizationId));
  const events =
    rows.length === 0
      ? []
      : await db
          .select({
            remediationId: findingRemediationEvents.remediationId,
            eventType: findingRemediationEvents.eventType,
            fromStatus: findingRemediationEvents.fromStatus,
            toStatus: findingRemediationEvents.toStatus,
            note: findingRemediationEvents.note,
            scanId: findingRemediationEvents.scanId,
            actorUserId: findingRemediationEvents.actorUserId,
            createdAt: findingRemediationEvents.createdAt,
          })
          .from(findingRemediationEvents)
          .where(
            and(
              eq(findingRemediationEvents.organizationId, organizationId),
              inArray(
                findingRemediationEvents.remediationId,
                rows.map((row) => row.id),
              ),
            ),
          )
          .orderBy(desc(findingRemediationEvents.createdAt))
          .limit(200);
  return { access, rows, members, events };
}

export async function updateFindingFollowup(input: {
  userId: string;
  organizationId: string;
  siteId: string;
  scanId: string;
  fingerprint: string;
  status: FollowupStatus;
  assigneeUserId: string | null;
  dueAt: Date | null;
  note: string | null;
}) {
  const access = await requireOrganizationAccess(
    input.userId,
    input.organizationId,
  );
  if (!canManageOrganization(access.role)) throw new OrganizationAccessError();
  if (!followupStatuses.includes(input.status))
    throw new Error("Statut invalide.");
  const note = input.note?.trim().slice(0, 2000) || null;
  if (input.status === "accepted" && !note)
    throw new Error(
      "Une justification est obligatoire pour accepter le risque.",
    );
  if (
    input.dueAt &&
    (!Number.isFinite(input.dueAt.getTime()) ||
      input.dueAt.getTime() < Date.UTC(2000, 0, 1))
  ) {
    throw new Error("Échéance invalide.");
  }
  return db.transaction(async (tx) => {
    const [finding] = await tx
      .select({
        fingerprint: findings.fingerprint,
        code: findings.code,
        title: findings.title,
        severity: findings.severity,
        scanMode: scans.scanMode,
      })
      .from(findings)
      .innerJoin(scans, eq(findings.scanId, scans.id))
      .where(
        and(
          eq(findings.organizationId, input.organizationId),
          eq(scans.organizationId, input.organizationId),
          eq(scans.siteId, input.siteId),
          eq(scans.id, input.scanId),
          eq(findings.fingerprint, input.fingerprint),
        ),
      )
      .limit(1);
    if (!finding) throw new Error("Constat introuvable.");
    if (input.assigneeUserId) {
      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, input.organizationId),
            eq(memberships.userId, input.assigneeUserId),
          ),
        )
        .limit(1);
      if (!member) throw new Error("Responsable hors de l’organisation.");
    }
    const [existing] = await tx
      .select()
      .from(findingRemediations)
      .where(
        and(
          eq(findingRemediations.organizationId, input.organizationId),
          eq(findingRemediations.siteId, input.siteId),
          eq(findingRemediations.scanMode, finding.scanMode),
          eq(findingRemediations.fingerprint, input.fingerprint),
        ),
      )
      .for("update")
      .limit(1);
    const values = {
      status: input.status,
      assigneeUserId: input.assigneeUserId,
      dueAt: input.dueAt,
      acceptanceReason: input.status === "accepted" ? note : null,
      updatedByUserId: input.userId,
      updatedAt: new Date(),
      lastSeenScanId: existing?.lastSeenScanId ?? input.scanId,
      suggestedScanId: null,
      code: finding.code,
      title: finding.title,
      severity: finding.severity,
    };
    const [record] = existing
      ? await tx
          .update(findingRemediations)
          .set(values)
          .where(eq(findingRemediations.id, existing.id))
          .returning()
      : await tx
          .insert(findingRemediations)
          .values({
            organizationId: input.organizationId,
            siteId: input.siteId,
            scanMode: finding.scanMode,
            fingerprint: input.fingerprint,
            ...values,
          })
          .returning();
    if (!record) throw new Error("Enregistrement impossible.");
    await tx.insert(findingRemediationEvents).values({
      remediationId: record.id,
      organizationId: input.organizationId,
      actorUserId: input.userId,
      scanId: input.scanId,
      eventType: existing ? "updated" : "created",
      fromStatus: existing?.status ?? null,
      toStatus: input.status,
      note,
    });
    return record;
  });
}
