import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCurrentSession } from "@/lib/current-session";
import {
  canManageOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "@/lib/organization-site-service";
import {
  getSiteVerificationChallengeState,
  SiteVerificationError,
} from "@/lib/site-verification";
import { VerificationPanel } from "./verification-panel";

type VerifySitePageProps = {
  params: Promise<{
    organizationId: string;
    siteId: string;
  }>;
};

async function loadVerificationPageData(
  userId: string,
  organizationId: string,
  siteId: string,
) {
  try {
    const access = await requireOrganizationAccess(userId, organizationId);

    if (!canManageOrganization(access.role)) {
      notFound();
    }

    const state = await getSiteVerificationChallengeState(
      userId,
      organizationId,
      siteId,
    );

    return { access, state };
  } catch (error) {
    if (
      error instanceof OrganizationAccessError ||
      error instanceof SiteVerificationError
    ) {
      notFound();
    }
    throw error;
  }
}

export default async function VerifySitePage({ params }: VerifySitePageProps) {
  const { organizationId, siteId } = await params;

  if (
    !OrganizationReadSchema.shape.id.safeParse(organizationId).success ||
    !SiteReadSchema.shape.id.safeParse(siteId).success
  ) {
    notFound();
  }

  const session = await requireCurrentSession();
  const { access, state } = await loadVerificationPageData(
    session.user.id,
    organizationId,
    siteId,
  );

  if (state.site.status === "active" && state.site.verifiedAt) {
    redirect(`/organizations/${organizationId}`);
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-8 lg:px-10">
      <Link
        href={`/organizations/${organizationId}`}
        className="text-sm text-white/45 transition hover:text-white/70"
      >
        ← Retour à {access.organizationName}
      </Link>

      <section className="py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
          Vérification du domaine
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {state.site.name}
        </h1>
        <p className="mt-3 break-all text-white/45">
          {state.site.canonicalUrl}
        </p>
        <p className="mt-5 max-w-2xl leading-7 text-white/55">
          Ajoutez le TXT indiqué ci-dessous dans la zone DNS du domaine. Agency
          Monitor n’activera le site qu’après détection du secret de
          vérification.
        </p>
      </section>

      <VerificationPanel
        organizationId={organizationId}
        siteId={siteId}
        recordName={state.recordName}
        existingExpiresAt={state.challenge?.expiresAt.toISOString() ?? null}
      />
    </main>
  );
}
