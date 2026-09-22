import {
  OrganizationReadSchema,
  ScanResultSchema,
  SiteReadSchema,
} from "@agency-saas/contracts";
import { getCurrentSession } from "@/lib/current-session";
import {
  getPrimaryScreenshotArtifact,
  readPrimaryScreenshot,
} from "@/lib/scan-artifact-service";
import { OrganizationAccessError } from "@/lib/organization-site-service";

type RouteContext = {
  params: Promise<{
    organizationId: string;
    siteId: string;
    scanId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getCurrentSession();
  if (!session) {
    return new Response(null, { status: 401 });
  }

  const { organizationId, siteId, scanId } = await context.params;
  if (
    !OrganizationReadSchema.shape.id.safeParse(organizationId).success ||
    !SiteReadSchema.shape.id.safeParse(siteId).success ||
    !ScanResultSchema.shape.scanId.safeParse(scanId).success
  ) {
    return new Response(null, { status: 404 });
  }

  try {
    const artifact = await getPrimaryScreenshotArtifact(
      session.user.id,
      organizationId,
      siteId,
      scanId,
    );
    if (!artifact) {
      return new Response(null, { status: 404 });
    }

    const data = await readPrimaryScreenshot(artifact);
    if (!data) {
      return new Response(null, { status: 404 });
    }

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": artifact.mediaType,
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=300",
        ETag: `"${artifact.sha256}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof OrganizationAccessError) {
      return new Response(null, { status: 404 });
    }
    throw error;
  }
}
