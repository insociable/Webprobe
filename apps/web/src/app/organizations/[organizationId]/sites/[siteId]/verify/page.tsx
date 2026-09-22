import { OrganizationReadSchema, SiteReadSchema } from "@agency-saas/contracts";
import { notFound, redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/product-shell";
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
    redirect("/organizations/" + organizationId);
  }

  return (
    <WorkspaceShell
      trail={[
        {
          label: access.organizationName,
          href: "/organizations/" + organizationId,
        },
        { label: state.site.name },
        { label: "Vérification DNS" },
      ]}
    >
      <section className="max-w-4xl border-b border-[#242d40] pb-9">
        <p className="am-kicker">Vérification du domaine</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em]">
          {state.site.name}
        </h1>
        <p className="mt-3 break-all text-[#7f8a9f]">
          {state.site.canonicalUrl}
        </p>
        <p className="mt-5 max-w-2xl leading-7 text-[#8793a8]">
          Ajoutez le TXT demandé dans la zone DNS. Agency Monitor reste
          volontairement fail-closed : aucun scan n’est possible tant que le
          challenge attendu n’est pas retrouvé.
        </p>
      </section>

      <section className="mt-8 max-w-4xl">
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {[
            ["01", "Générer", "Obtenir le secret TXT"],
            ["02", "Publier", "Ajouter le TXT au DNS"],
            ["03", "Vérifier", "Activer la supervision"],
          ].map(([number, title, detail]) => (
            <div key={number} className="am-panel-soft p-4">
              <p className="font-mono text-[10px] text-[#6d7cff]">{number}</p>
              <p className="mt-2 text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs leading-5 text-[#6f7b91]">{detail}</p>
            </div>
          ))}
        </div>

        <VerificationPanel
          organizationId={organizationId}
          siteId={siteId}
          recordName={state.recordName}
          existingExpiresAt={state.challenge?.expiresAt.toISOString() ?? null}
        />
      </section>
    </WorkspaceShell>
  );
}
