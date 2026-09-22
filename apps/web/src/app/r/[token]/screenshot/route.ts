import { getPublicReportByToken } from "@/lib/public-report-service";
import {
  getPrimaryScreenshotArtifactForScope,
  readPrimaryScreenshot,
} from "@/lib/scan-artifact-service";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const report = await getPublicReportByToken(token);
  if (!report) {
    return new Response(null, { status: 404 });
  }

  const artifact = await getPrimaryScreenshotArtifactForScope(
    report.scope.organizationId,
    report.scope.siteId,
    report.scope.scanId,
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
      "Cache-Control": "private, no-store",
      ETag: '"' + artifact.sha256 + '"',
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
