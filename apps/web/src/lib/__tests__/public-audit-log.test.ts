import { afterEach, describe, expect, it, vi } from "vitest";
import { logPublicAuditEvent } from "../public-audit-log";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("public audit structured logging", () => {
  it("logs bounded identifiers and hostname for queued audits", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logPublicAuditEvent({
      event: "queued",
      userId: "user-id",
      organizationId: "organization-id",
      siteId: "site-id",
      scanId: "scan-id",
      hostname: "example.com",
    });

    const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(payload).toEqual({
      scope: "public-audit",
      event: "queued",
      userId: "user-id",
      organizationId: "organization-id",
      siteId: "site-id",
      scanId: "scan-id",
      hostname: "example.com",
    });
  });

  it("records rejection reason without requiring target URL data", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logPublicAuditEvent({
      event: "rejected",
      userId: "user-id",
      organizationId: "organization-id",
      siteId: "site-id",
      reason: "site-not-found",
    });

    const serialized = String(info.mock.calls[0]?.[0]);
    expect(serialized).toContain('"reason":"site-not-found"');
    expect(serialized).not.toContain("canonicalUrl");
    expect(serialized).not.toContain("token");
  });
});
