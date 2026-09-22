import { createDatabase, type DatabaseConnection } from "@agency-saas/db";

let database: DatabaseConnection | undefined;

export function getDatabase(): DatabaseConnection {
  if (database) {
    return database;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  database = createDatabase(databaseUrl);
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (!database) {
    return;
  }

  await database.client.end();
  database = undefined;
}
