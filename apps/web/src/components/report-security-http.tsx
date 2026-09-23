import { getFindingRemediation } from "@/lib/finding-remediation";
import { sanitizeReportHeaderValue } from "@/lib/report-technical-details";
import {
  getSecurityHttpControls,
  type SecurityHttpControl,
} from "@/lib/security-http-controls";

const statusLabels = {
  pass: "Conforme",
  warning: "À améliorer",
  fail: "À corriger",
  "not-applicable": "Non applicable",
} as const;

const statusSymbols = {
  pass: "✓",
  warning: "⚠",
  fail: "×",
  "not-applicable": "—",
} as const;

const statusStyles = {
  pass: "border-emerald-400/30 bg-emerald-400/[0.07] text-emerald-200",
  warning: "border-amber-300/30 bg-amber-300/[0.07] text-amber-100",
  fail: "border-rose-400/30 bg-rose-400/[0.07] text-rose-100",
  "not-applicable": "border-[#33405a] bg-[#111827] text-[#7f8a9f]",
} as const;

const findingCodeByHeader: Record<string, string> = {
  "content-security-policy": "security-header.csp.missing",
  "strict-transport-security": "security-header.hsts.missing",
  "x-content-type-options": "security-header.x-content-type-options.missing",
  "referrer-policy": "security-header.referrer-policy.missing",
  "permissions-policy": "security-header.permissions-policy.missing",
  "x-frame-options": "security-header.x-frame-options.missing",
};

function recommendationForControl(control: SecurityHttpControl): string | null {
  if (
    control.name === "content-security-policy" &&
    control.status === "warning"
  ) {
    return "Réduire progressivement les directives permissives. Préférer des nonces ou hashes aux scripts inline et supprimer unsafe-eval lorsque les dépendances le permettent.";
  }

  const code = findingCodeByHeader[control.name];
  if (!code || control.status !== "fail") return null;
  return getFindingRemediation(code)?.summary ?? null;
}

export function ReportSecurityHttp({ summary }: { summary: unknown }) {
  const controls = getSecurityHttpControls(summary);
  if (controls.length === 0) return null;

  return (
    <section className="border-b border-[#242d40] py-10">
      <p className="am-kicker">Sécurité HTTP</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
        Protections navigateur observées
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7f8a9f]">
        Lecture directe des headers réellement reçus. Un contrôle absent ou
        améliorable ne signifie pas qu’une vulnérabilité a été exploitée.
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-[#242d40] bg-[#0a0f18]">
        {controls.map((control) => {
          const recommendation = recommendationForControl(control);
          const hasDetails =
            control.notes.length > 0 ||
            control.value !== null ||
            recommendation !== null;

          return (
            <details
              key={control.name}
              className="group border-b border-[#242d40] last:border-b-0"
            >
              <summary className="grid cursor-pointer list-none gap-3 px-5 py-4 transition hover:bg-[#0f1520] sm:grid-cols-[32px_minmax(0,1fr)_130px_20px] sm:items-center [&::-webkit-details-marker]:hidden">
                <span
                  className={
                    "inline-flex size-7 items-center justify-center rounded-md border text-sm font-bold " +
                    statusStyles[control.status]
                  }
                >
                  {statusSymbols[control.status]}
                </span>
                <span className="font-medium text-[#dfe5f2]">
                  {control.label}
                </span>
                <span className="text-xs font-medium text-[#8b97aa]">
                  {statusLabels[control.status]}
                </span>
                <span
                  aria-hidden="true"
                  className={
                    "text-xs text-[#59647a] transition " +
                    (hasDetails ? "group-open:rotate-180" : "")
                  }
                >
                  {hasDetails ? "▾" : ""}
                </span>
              </summary>

              {hasDetails ? (
                <div className="border-t border-[#1d2535] bg-[#0c111a] px-5 py-5 sm:pl-16">
                  {control.notes.length > 0 ? (
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#647188]">
                        Points détectés
                      </p>
                      <ul className="mt-2 space-y-1 text-sm leading-6 text-[#9aa6b9]">
                        {control.notes.map((note) => (
                          <li key={note}>• {note}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {recommendation ? (
                    <div className="mt-4">
                      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#647188]">
                        Recommandation
                      </p>
                      <p className="mt-2 max-w-4xl text-sm leading-6 text-[#9aa6b9]">
                        {recommendation}
                      </p>
                    </div>
                  ) : null}

                  {control.value ? (
                    <div className="mt-4">
                      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#647188]">
                        Valeur observée
                      </p>
                      <code className="mt-2 block break-all rounded-md border border-[#242d40] bg-[#070a10] p-3 text-xs leading-5 text-[#9ba7ba]">
                        {sanitizeReportHeaderValue(control.value)}
                      </code>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </details>
          );
        })}
      </div>
    </section>
  );
}
