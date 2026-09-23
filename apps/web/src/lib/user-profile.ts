import { users } from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { db } from "./database";

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function parseDisplayName(
  value: FormDataEntryValue | null,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeDisplayName(value);
  return normalized.length >= 2 && normalized.length <= 80 ? normalized : null;
}

export async function updateUserDisplayName(
  userId: string,
  displayName: string,
) {
  await db
    .update(users)
    .set({ displayName, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
