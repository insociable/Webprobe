"use server";

import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import { redirect } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import { OrganizationAccessError } from "@/lib/organization-site-service";
import {
  createSiteVerificationChallenge,
  SiteVerificationError,
  verifySiteDnsChallenge,
} from "@/lib/site-verification";

export type VerificationActionState = {
  error: string | null;
  token: string | null;
  recordName: string | null;
  expiresAt: string | null;
};

const initialVerificationActionState: VerificationActionState = {
  error: null,
  token: null,
  recordName: null,
  expiresAt: null,
};

function validIds(organizationId: string, siteId: string): boolean {
  return (
    OrganizationReadSchema.shape.id.safeParse(organizationId).success &&
    SiteReadSchema.shape.id.safeParse(siteId).success
  );
}

function humanVerificationError(error: unknown): string {
  if (error instanceof OrganizationAccessError) {
    return "Vous n’êtes pas autorisé à vérifier ce site.";
  }

  if (error instanceof SiteVerificationError) {
    switch (error.code) {
      case "challenge-not-found":
        return "Générez d’abord un enregistrement de vérification.";
      case "challenge-expired":
        return "Le challenge a expiré. Générez-en un nouveau.";
      case "dns-record-not-found":
        return "Le TXT attendu n’est pas encore visible dans le DNS.";
      case "already-verified":
        return "Ce site est déjà vérifié.";
      case "site-not-found":
        return "Site introuvable.";
    }
  }

  return "La vérification a échoué pour le moment.";
}

export async function generateVerificationChallengeAction(
  organizationId: string,
  siteId: string,
  _previousState: VerificationActionState,
  _formData: FormData,
): Promise<VerificationActionState> {
  void _previousState;
  void _formData;

  if (!validIds(organizationId, siteId)) {
    return { ...initialVerificationActionState, error: "Site invalide." };
  }

  const session = await requireCurrentSession();

  try {
    const challenge = await createSiteVerificationChallenge(
      session.user.id,
      organizationId,
      siteId,
    );

    return {
      error: null,
      token: challenge.token,
      recordName: challenge.recordName,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  } catch (error) {
    return {
      ...initialVerificationActionState,
      error: humanVerificationError(error),
    };
  }
}

export async function verifyDnsChallengeAction(
  organizationId: string,
  siteId: string,
  _previousState: VerificationActionState,
  _formData: FormData,
): Promise<VerificationActionState> {
  void _previousState;
  void _formData;

  if (!validIds(organizationId, siteId)) {
    return { ...initialVerificationActionState, error: "Site invalide." };
  }

  const session = await requireCurrentSession();

  try {
    await verifySiteDnsChallenge(session.user.id, organizationId, siteId);
  } catch (error) {
    return {
      ...initialVerificationActionState,
      error: humanVerificationError(error),
    };
  }

  redirect(`/organizations/${organizationId}/sites/${siteId}`);
}
