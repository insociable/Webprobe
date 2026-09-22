export type PublicAuditLimits = {
  userHourlyLimit: number;
  userConcurrentLimit: number;
  domainCooldownMs: number;
};

const DEFAULT_USER_HOURLY_LIMIT = 6;
const DEFAULT_USER_CONCURRENT_LIMIT = 2;
const DEFAULT_DOMAIN_COOLDOWN_SECONDS = 10 * 60;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPublicAuditLimits(
  env: NodeJS.ProcessEnv = process.env,
): PublicAuditLimits {
  return {
    userHourlyLimit: positiveInteger(
      env.PUBLIC_AUDIT_USER_HOURLY_LIMIT,
      DEFAULT_USER_HOURLY_LIMIT,
    ),
    userConcurrentLimit: positiveInteger(
      env.PUBLIC_AUDIT_USER_CONCURRENT_LIMIT,
      DEFAULT_USER_CONCURRENT_LIMIT,
    ),
    domainCooldownMs:
      positiveInteger(
        env.PUBLIC_AUDIT_DOMAIN_COOLDOWN_SECONDS,
        DEFAULT_DOMAIN_COOLDOWN_SECONDS,
      ) * 1000,
  };
}
