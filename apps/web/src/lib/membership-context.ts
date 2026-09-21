import { memberships, organizations } from "@agency-saas/db";
import { asc, eq } from "drizzle-orm";
import { db } from "./database";

export async function getUserMemberships(userId: string) {
  return db
    .select({
      membershipId: memberships.id,
      organizationId: organizations.id,
      organizationName: organizations.name,
      role: memberships.role,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
}
