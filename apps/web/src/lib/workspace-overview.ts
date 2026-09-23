import { redirect } from "next/navigation";
import { requireCurrentSession } from "./current-session";
import { getUserMemberships } from "./membership-context";
import { getOrganizationOverview } from "./organization-overview";

export async function getWorkspaceOverview() {
  const session = await requireCurrentSession();
  const memberships = await getUserMemberships(session.user.id);

  if (memberships.length === 0) {
    redirect("/onboarding");
  }

  const overviews = await Promise.all(
    memberships.map((membership) =>
      getOrganizationOverview(session.user.id, membership.organizationId),
    ),
  );
  const sites = memberships.flatMap((membership, index) =>
    overviews[index]!.sites.map((site) => ({
      ...site,
      organizationId: membership.organizationId,
    })),
  );
  const manageableMembership = memberships.find(
    (membership) => membership.role !== "member",
  );
  const createSiteHref = manageableMembership
    ? `/organizations/${manageableMembership.organizationId}/sites/new`
    : null;

  return {
    user: session.user,
    sites,
    createSiteHref,
    scansInProgress: sites.filter(
      (site) =>
        site.latestScan?.status === "queued" ||
        site.latestScan?.status === "running",
    ).length,
    majorFindings: sites.reduce(
      (total, site) =>
        total +
        (site.latestScan?.highCount ?? 0) +
        (site.latestScan?.criticalCount ?? 0),
      0,
    ),
  };
}
