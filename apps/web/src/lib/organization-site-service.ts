import {
  OrganizationCreateSchema,
  SiteCreateSchema,
  type OrganizationCreate,
  type SiteCreate,
} from "@agency-saas/contracts";
import { memberships, organizations, sites } from "@agency-saas/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./database";
import { canManageOrganization } from "./organization-permissions";

export { canManageOrganization } from "./organization-permissions";

export class OrganizationAccessError extends Error {
  constructor(message = "Organization access denied") {
    super(message);
    this.name = "OrganizationAccessError";
  }
}

export class AlreadyOnboardedError extends Error {
  constructor() {
    super("User already belongs to an organization");
    this.name = "AlreadyOnboardedError";
  }
}

export async function getOrganizationAccess(
  userId: string,
  organizationId: string,
) {
  const rows = await db
    .select({
      membershipId: memberships.id,
      organizationId: organizations.id,
      organizationName: organizations.name,
      role: memberships.role,
      scanAlertEnabled: memberships.scanAlertEnabled,
      scanAlertMinimumSeverity: memberships.scanAlertMinimumSeverity,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.organizationId, organizationId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function requireOrganizationAccess(
  userId: string,
  organizationId: string,
) {
  const access = await getOrganizationAccess(userId, organizationId);
  if (!access) {
    throw new OrganizationAccessError();
  }
  return access;
}
export async function createOrganizationForUser(
  userId: string,
  input: OrganizationCreate,
) {
  const data = OrganizationCreateSchema.parse(input);

  return db.transaction(async (tx) => {
    const [organization] = await tx
      .insert(organizations)
      .values({ name: data.name })
      .returning();

    if (!organization) {
      throw new Error("Organization creation failed");
    }

    await tx.insert(memberships).values({
      organizationId: organization.id,
      userId,
      role: "owner",
    });

    return organization;
  });
}

export async function createInitialOrganizationForUser(
  userId: string,
  input: OrganizationCreate,
) {
  const data = OrganizationCreateSchema.parse(input);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${userId})::bigint)`,
    );

    const existingMembership = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .limit(1);

    if (existingMembership.length > 0) {
      throw new AlreadyOnboardedError();
    }

    const [organization] = await tx
      .insert(organizations)
      .values({ name: data.name })
      .returning();

    if (!organization) {
      throw new Error("Organization creation failed");
    }

    await tx.insert(memberships).values({
      organizationId: organization.id,
      userId,
      role: "owner",
    });

    return organization;
  });
}

export async function listSitesForOrganization(
  userId: string,
  organizationId: string,
) {
  await requireOrganizationAccess(userId, organizationId);

  return db
    .select()
    .from(sites)
    .where(eq(sites.organizationId, organizationId))
    .orderBy(asc(sites.createdAt));
}
export async function createSiteForOrganization(
  userId: string,
  organizationId: string,
  input: SiteCreate,
) {
  const access = await requireOrganizationAccess(userId, organizationId);
  if (!canManageOrganization(access.role)) {
    throw new OrganizationAccessError(
      "Only organization owners and admins can create sites",
    );
  }

  const data = SiteCreateSchema.parse(input);
  const [site] = await db
    .insert(sites)
    .values({
      organizationId,
      name: data.name,
      canonicalUrl: data.canonicalUrl,
      status: "pending_verification",
    })
    .returning();

  if (!site) {
    throw new Error("Site creation failed");
  }

  return site;
}

export async function getSiteForOrganization(
  userId: string,
  organizationId: string,
  siteId: string,
) {
  await requireOrganizationAccess(userId, organizationId);

  const rows = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.organizationId, organizationId)))
    .limit(1);

  return rows[0] ?? null;
}
