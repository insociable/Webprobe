import type { FindingRemediation } from "@/lib/finding-remediation";

type RemediationDetailsProps = {
  remediation: FindingRemediation | null;
  fallback?: string | null;
  verification?: string | null;
};

export function RemediationDetails({
  remediation,
  fallback = null,
  verification = null,
}: RemediationDetailsProps) {
  const summary = remediation?.summary ?? fallback;
  const steps = remediation?.steps ?? [];
  const verificationCopy = remediation?.verification ?? verification;

  if (!summary && steps.length === 0 && !verificationCopy) {
    return null;
  }

  return (
    <details className="mt-3 rounded-md border border-[#33405a] bg-[#111827]/70">
      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-[#aab2ff] [&::-webkit-details-marker]:hidden">
        Remédiation
      </summary>
      <div className="border-t border-[#29344b] px-3 py-3">
        {remediation?.title ? (
          <p className="text-sm font-semibold text-white/80">
            {remediation.title}
          </p>
        ) : null}
        {summary ? (
          <p className="mt-2 text-sm leading-5 text-white/60">{summary}</p>
        ) : null}
        {steps.length > 0 ? (
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-5 text-white/55">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}
        {verificationCopy ? (
          <p className="mt-3 text-sm leading-5 text-white/45">
            <strong className="font-semibold text-white/60">
              Vérification :
            </strong>{" "}
            {verificationCopy}
          </p>
        ) : null}
      </div>
    </details>
  );
}
