"use server";

import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import { revalidatePath } from "next/cache";
import { requireCurrentSession } from "@/lib/current-session";
import {
  DeepCrawlConsentError,
  grantDeepCrawlConsent,
  revokeDeepCrawlConsent,
} from "@/lib/deep-crawl-consents";

export type DeepCrawlConsentActionState = {
  error: string | null;
  message: string | null;
};

const disabledMessage =
  "La préparation du crawl multi-pages n’est pas activée sur cet environnement.";

function validateRequest(
  organizationId: string,
  siteId: string,
): string | null {
  if (process.env.WEBPROBE_DEEP_MULTIPAGE_CONSENT_UI !== "enabled")
    return disabledMessage;
  if (
    !OrganizationReadSchema.shape.id.safeParse(organizationId).success ||
    !SiteReadSchema.shape.id.safeParse(siteId).success
  )
    return "Identifiant de site invalide.";
  return null;
}

function explanation(error: unknown): string {
  if (error instanceof DeepCrawlConsentError) {
    switch (error.code) {
      case "invalid-page-count":
        return "Le nombre maximal de pages doit être compris entre 2 et 5.";
      case "invalid-paths":
        return "Saisissez de 1 à 10 chemins sûrs, un par ligne, sans paramètres et sans racine /.";
      case "site-not-verified":
        return "La preuve DNS de propriété du domaine doit être revérifiée.";
      case "deep-grant-required":
        return "La preuve d’autorisation Deep doit être revérifiée.";
      case "grant-too-close-to-expiry":
        return "La preuve DNS expire bientôt : renouvelez-la avant de donner cet accord.";
    }
  }
  return "Opération refusée ou temporairement indisponible.";
}

/** Deliberate opt-in; never reads a consent or permission from scan job data. */
export async function grantDeepCrawlConsentAction(
  organizationId: string,
  siteId: string,
  _state: DeepCrawlConsentActionState,
  formData: FormData,
): Promise<DeepCrawlConsentActionState> {
  void _state;
  const error = validateRequest(organizationId, siteId);
  if (error) return { error, message: null };
  if (formData.get("confirmation") !== "yes")
    return {
      error: "Confirmez explicitement le périmètre et les limites.",
      message: null,
    };
  const rawPages = formData.get("maxPages");
  const rawPaths = formData.get("pathPrefixes");
  if (
    typeof rawPages !== "string" ||
    !/^[2-5]$/.test(rawPages) ||
    typeof rawPaths !== "string" ||
    rawPaths.length > 1500
  )
    return { error: "Paramètres d'autorisation invalides.", message: null };
  const prefixes = rawPaths
    .split(/\r?\n/u)
    .map((path) => path.trim())
    .filter(Boolean);
  const session = await requireCurrentSession();
  try {
    await grantDeepCrawlConsent({
      userId: session.user.id,
      organizationId,
      siteId,
      maxPages: Number(rawPages),
      allowedPathPrefixes: prefixes,
    });
    revalidatePath("/organizations/" + organizationId + "/sites/" + siteId);
    return {
      message:
        "Consentement de préparation enregistré (aucune navigation supplémentaire n'est activée).",
      error: null,
    };
  } catch (cause) {
    return { error: explanation(cause), message: null };
  }
}

/** Dedicated revoke action; no confirmation field trusted from a GET request. */
export async function revokeDeepCrawlConsentAction(
  organizationId: string,
  siteId: string,
  _state: DeepCrawlConsentActionState,
  formData: FormData,
): Promise<DeepCrawlConsentActionState> {
  void _state;
  const error = validateRequest(organizationId, siteId);
  if (error) return { error, message: null };
  if (formData.get("confirmation") !== "revoke")
    return {
      error: "Confirmez la révocation de ce consentement.",
      message: null,
    };
  const session = await requireCurrentSession();
  try {
    const result = await revokeDeepCrawlConsent({
      userId: session.user.id,
      organizationId,
      siteId,
    });
    revalidatePath("/organizations/" + organizationId + "/sites/" + siteId);
    return {
      error: null,
      message: result.revoked
        ? "Consentement révoqué."
        : "Aucun consentement actif à révoquer.",
    };
  } catch (cause) {
    return { error: explanation(cause), message: null };
  }
}
