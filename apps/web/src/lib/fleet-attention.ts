import { hasCurrentSiteOwnershipProof } from "@agency-saas/security";
import type { getWorkspaceOverview } from "./workspace-overview";

type Site = Awaited<ReturnType<typeof getWorkspaceOverview>>["sites"][number];
export type FleetUrgency = "urgent" | "followup" | "none";

export function fleetAttention(site: Site, now = new Date()) {
  const siteHref = `/organizations/${site.organizationId}/sites/${site.id}`;
  const scanHref = site.latestScan
    ? `${siteHref}/scans/${site.latestScan.id}`
    : siteHref;
  const proofInvalid = Boolean(
    site.verifiedAt && !hasCurrentSiteOwnershipProof(site, now),
  );
  const proofBeforeNextRun = Boolean(
    site.ownershipExpiresAt &&
      site.monitoringNextRunAt &&
      site.ownershipExpiresAt <= site.monitoringNextRunAt &&
      !proofInvalid,
  );
  const scanOverdue = Boolean(
    site.monitoringScheduleEnabled &&
      site.monitoringNextRunAt &&
      site.monitoringNextRunAt < now,
  );
  const scheduledFailure = Boolean(
    site.latestScan?.trigger === "scheduled" &&
      (site.latestScan.status === "failed" ||
        site.latestScan.status === "cancelled"),
  );
  const criticalCount = site.latestScan?.criticalCount ?? 0;
  const highCount = site.latestScan?.highCount ?? 0;
  const newMajorCount = site.latestScan?.newMajorCount ?? 0;
  const notes: string[] = [];
  if (proofInvalid) notes.push("Preuve DNS invalide ou expirée");
  else if (proofBeforeNextRun)
    notes.push("Preuve DNS expire avant le prochain scan");
  if (scanOverdue) notes.push("Scan planifié en retard");
  if (scheduledFailure) notes.push("Dernier scan planifié en échec");
  if (newMajorCount > 0)
    notes.push(`${newMajorCount} nouveau(x) constat(s) important(s)`);
  if (criticalCount + highCount > 0)
    notes.push(
      `${criticalCount + highCount} constat(s) élevé(s) ou critique(s) au dernier scan`,
    );
  if (site.openFollowupCount > 0)
    notes.push(`${site.openFollowupCount} suivi(s) de remédiation ouvert(s)`);
  if (site.status === "active" && !site.monitoringScheduleEnabled)
    notes.push("Suivi récurrent absent ou arrêté");
  const urgency: FleetUrgency =
    proofInvalid || scanOverdue || scheduledFailure || criticalCount > 0
      ? "urgent"
      : notes.length > 0
        ? "followup"
        : "none";
  const action = proofInvalid
    ? { label: "Renouveler la preuve DNS", href: `${siteHref}/verify` }
    : scanOverdue || scheduledFailure
      ? { label: "Examiner le suivi", href: siteHref }
      : newMajorCount > 0 ||
          criticalCount + highCount > 0 ||
          site.openFollowupCount > 0
        ? { label: "Voir les constats", href: scanHref }
        : proofBeforeNextRun
          ? { label: "Vérifier la preuve DNS", href: `${siteHref}/verify` }
          : site.status === "active" && !site.monitoringScheduleEnabled
            ? { label: "Configurer le suivi", href: siteHref }
            : { label: "Ouvrir le site", href: siteHref };
  return {
    urgency,
    notes,
    action,
    scanOverdue,
    proofInvalid,
    proofBeforeNextRun,
    scheduledFailure,
  };
}
