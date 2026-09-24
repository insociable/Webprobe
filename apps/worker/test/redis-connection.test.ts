import { describe, expect, it } from "vitest";
import { parseRedisConnectionUrl } from "../src/redis-connection.js";

describe("parseRedisConnectionUrl", () => {
  it("preserves the Redis database path", () => {
    expect(parseRedisConnectionUrl("redis://localhost:6380/15")).toEqual({
      host: "localhost",
      port: 6380,
      db: 15,
    });
  });

  it("enables TLS for rediss URLs", () => {
    expect(
      parseRedisConnectionUrl("rediss://user:p%40ss@example.com/2"),
    ).toEqual({
      host: "example.com",
      port: 6379,
      username: "user",
      password: "p@ss",
      db: 2,
      tls: {},
    });
  });

  it.each([
    undefined,
    "",
    "https://localhost:6379/0",
    "redis://localhost/not-a-db",
    "redis://localhost/1?foo=bar",
  ])("rejects unsupported Redis URL %s", (value) => {
    expect(() => parseRedisConnectionUrl(value)).toThrow();
  });
});
