"use server";

import {
  OrganizationReadSchema,
  ReportRecipientEmailSchema,
  ScanResultSchema,
  SiteReadSchema,
} from "@agency-saas/contracts";
import { revalidatePath } from "next/cache";
import { requireCurrentSession } from "@/lib/current-session";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import {
  createReportShare,
  queueReportEmail,
  ReportShareEligibilityError,
  ReportShareRateLimitError,
  revokeReportShare,
} from "@/lib/report-share-service";

export type ReportShareActionState = {
  error: string | null;
  message: string | null;
};

function validScope(
  organizationId: string,
  siteId: string,
  scanId: string,
): boolean {
  return (
    OrganizationReadSchema.shape.id.safeParse(organizationId).success &&
    SiteReadSchema.shape.id.safeParse(siteId).success &&
    ScanResultSchema.shape.scanId.safeParse(scanId).success
  );
}

function scanPath(
  organizationId: string,
  siteId: string,
  scanId: string,
): string {
  return (
    "/organizations/" + organizationId + "/sites/" + siteId + "/scans/" + scanId
  );
}

export async function createReportShareAction(
  organizationId: string,
  siteId: string,
  scanId: string,
  _previous: ReportShareActionState,
  _formData: FormData,
): Promise<ReportShareActionState> {
  void _previous;
  void _formData;
  if (!validScope(organizationId, siteId, scanId)) {
    return { error: "Scan invalide.", message: null };
  }

  const session = await requireCurrentSession();
  try {
    await createReportShare(session.user.id, organizationId, siteId, scanId);
  } catch (error) {
    return {
      error:
        error instanceof OrganizationAccessError
          ? "Vous n’êtes pas autorisé à partager ce rapport."
          : error instanceof ReportShareEligibilityError
            ? "Cet audit public reste privé tant que le site n’est pas vérifié."
            : error instanceof ReportShareRateLimitError
              ? "Quota de liens de partage atteint pour ce rapport."
              : "Impossible de créer le lien pour le moment.",
      message: null,
    };
  }

  revalidatePath(scanPath(organizationId, siteId, scanId));
  return { error: null, message: "Lien de partage créé pour 7 jours." };
}

export async function sendReportEmailAction(
  organizationId: string,
  siteId: string,
  scanId: string,
  _previous: ReportShareActionState,
  formData: FormData,
): Promise<ReportShareActionState> {
  void _previous;
  if (!validScope(organizationId, siteId, scanId)) {
    return { error: "Scan invalide.", message: null };
  }

  const email = ReportRecipientEmailSchema.safeParse(
    formData.get("recipientEmail"),
  );
  if (!email.success) {
    return { error: "Adresse e-mail invalide.", message: null };
  }

  const session = await requireCurrentSession();
  try {
    await queueReportEmail(
      session.user.id,
      organizationId,
      siteId,
      scanId,
      email.data,
    );
  } catch (error) {
    return {
      error:
        error instanceof OrganizationAccessError
          ? "Vous n’êtes pas autorisé à envoyer ce rapport."
          : error instanceof ReportShareEligibilityError
            ? "Cet audit public reste privé tant que le site n’est pas vérifié."
            : error instanceof ReportShareRateLimitError
              ? "Quota d’envoi atteint. Réessayez plus tard ou utilisez un lien de partage existant."
              : "Impossible de mettre l’e-mail en file pour le moment.",
      message: null,
    };
  }

  revalidatePath(scanPath(organizationId, siteId, scanId));
  return {
    error: null,
    message: "Rapport mis en file pour envoi à " + email.data + ".",
  };
}

export async function revokeReportShareAction(
  organizationId: string,
  siteId: string,
  scanId: string,
  shareId: string,
): Promise<void> {
  if (
    !validScope(organizationId, siteId, scanId) ||
    !OrganizationReadSchema.shape.id.safeParse(shareId).success
  ) {
    return;
  }

  const session = await requireCurrentSession();
  try {
    await revokeReportShare(
      session.user.id,
      organizationId,
      siteId,
      scanId,
      shareId,
    );
  } catch {
    return;
  }

  revalidatePath(scanPath(organizationId, siteId, scanId));
}
