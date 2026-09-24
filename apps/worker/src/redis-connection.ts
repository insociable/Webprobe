export type ParsedRedisConnection = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  tls?: Record<string, never>;
};

export function parseRedisConnectionUrl(
  rawUrl: string | undefined,
): ParsedRedisConnection {
  if (!rawUrl?.trim()) throw new Error("REDIS_URL is required");

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("REDIS_URL is invalid");
  }

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis: or rediss:");
  }
  if (!url.hostname) throw new Error("REDIS_URL hostname is required");
  if (url.search || url.hash)
    throw new Error("REDIS_URL query parameters and fragments are unsupported");

  const dbText = url.pathname.replace(/^\/+/, "");
  const db = dbText === "" ? 0 : Number(dbText);
  if (!Number.isSafeInteger(db) || db < 0) {
    throw new Error("REDIS_URL database path must be a non-negative integer");
  }

  const port = url.port === "" ? 6379 : Number(url.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("REDIS_URL port is invalid");
  }

  return {
    host: url.hostname,
    port,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    db,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}
