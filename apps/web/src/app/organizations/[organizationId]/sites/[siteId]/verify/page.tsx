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
  const { state } = await loadVerificationPageData(
    session.user.id,
    organizationId,
    siteId,
  );

  if (state.site.status === "active" && state.site.verifiedAt) {
    redirect("/organizations/" + organizationId);
  }

  return (
    <WorkspaceShell
      currentOrganizationId={organizationId}
      trail={[{ label: state.site.name }, { label: "Vérification DNS" }]}
    >
      <section className="max-w-4xl border-b border-[#242d40] pb-9">
        <p className="am-kicker">Activer le monitoring</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em]">
          {state.site.name}
        </h1>
        <p className="mt-3 break-all text-[#7f8a9f]">
          {state.site.canonicalUrl}
        </p>
        <p className="mt-5 max-w-2xl leading-7 text-[#8793a8]">
          Ajoutez le TXT demandé dans la zone DNS pour prouver le contrôle du
          domaine. Les audits publics restent possibles sans cette étape, mais
          le monitoring planifié, les alertes et les automatisations restent
          désactivés tant que le challenge n’est pas validé.
        </p>
      </section>

      <section className="mt-8 max-w-4xl">
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {[
            ["01", "Générer", "Obtenir le secret TXT"],
            ["02", "Publier", "Ajouter le TXT au DNS"],
            ["03", "Vérifier", "Activer le monitoring"],
          ].map(([number, title, detail]) => (
            <div key={number} className="am-panel-soft p-4">
              <p className="font-mono text-[10px] text-[#6d7cff]">{number}</p>
              <p className="mt-2 text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs leading-5 text-[#6f7b91]">{detail}</p>
            </div>
          ))}
        </div>

        <section className="mb-8">
          <p className="am-kicker">Après vérification</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
            Ce que le contrôle du domaine débloque
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              [
                "Monitoring continu",
                "Scans de monitoring manuels et planning hebdomadaire sur le domaine vérifié.",
              ],
              [
                "Alertes",
                "Notifications sur les incidents et rétablissements observés par le monitoring.",
              ],
              [
                "Partage de rapports",
                "Liens temporaires et envoi de rapports lorsque le domaine a été vérifié.",
              ],
              [
                "Historique distinct",
                "Les audits publics passés restent visibles selon la politique de rétention et leurs comparaisons restent séparées du monitoring.",
              ],
            ].map(([title, detail]) => (
              <article key={title} className="am-panel-soft p-5">
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#7f8a9f]">
                  {detail}
                </p>
              </article>
            ))}
          </div>
          <p className="mt-4 border-l-2 border-[#40506d] pl-4 text-xs leading-5 text-[#68758c]">
            La vérification n’altère pas les audits déjà réalisés : elle
            autorise les futurs scans de monitoring et leurs propres baselines.
          </p>
        </section>

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
