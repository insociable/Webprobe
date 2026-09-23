import { collectCachedPublicReadiness } from "@/lib/health-readiness";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const readiness = await collectCachedPublicReadiness();
  return Response.json(readiness, {
    status: readiness.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
