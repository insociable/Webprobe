import { collectPublicReadiness } from "@/lib/health-readiness";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const readiness = await collectPublicReadiness();
  return Response.json(readiness, {
    status: readiness.status === "ready" ? 200 : 503,
  });
}
