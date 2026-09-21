import { createDatabase } from "@agency-saas/db";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const database = createDatabase(requiredEnv("DATABASE_URL"));

export const db = database.db;
export const dbClient = database.client;
