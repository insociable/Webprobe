import { createDatabase } from "@agency-saas/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return Response.json(
      { status: "degraded", database: "not-configured" },
      { status: 503 },
    );
  }

  const { client } = createDatabase(databaseUrl);

  try {
    await client`select 1 as healthy`;
    return Response.json({
      status: "ok",
      database: "up",
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return Response.json(
      { status: "degraded", database: "down" },
      { status: 503 },
    );
  } finally {
    await client.end({ timeout: 1 });
  }
}
