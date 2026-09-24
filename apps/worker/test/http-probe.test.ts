import { describe, expect, it } from "vitest";
import type { DnsResolver } from "@agency-saas/security";
import {
  inspectSecurityHeaders,
  probeHttpTarget,
  type HttpRequester,
} from "../src/http-probe.js";

const publicResolver: DnsResolver = async (hostname) => [
  {
    address: hostname === "example.com" ? "93.184.216.34" : "1.1.1.1",
    family: 4,
  },
];

describe("inspectSecurityHeaders", () => {
  it("expects HSTS only for HTTPS", () => {
    const headers = { "strict-transport-security": "max-age=31536000" };
    const https = inspectSecurityHeaders(headers, "https:");
    const http = inspectSecurityHeaders(headers, "http:");

    expect(
      https.find((item) => item.name === "strict-transport-security"),
    ).toMatchObject({ expected: true, present: true });
    expect(
      http.find((item) => item.name === "strict-transport-security"),
    ).toMatchObject({ expected: false, present: true });
  });
});
describe("probeHttpTarget", () => {
  it("returns only report-safe headers and probe metadata", async () => {
    const requester: HttpRequester = async (target) => {
      expect(target.addresses).toEqual(["93.184.216.34"]);
      return {
        statusCode: 200,
        durationMs: 42,
        tls: {
          protocol: "TLSv1.3",
          cipher: "TLS_AES_256_GCM_SHA384",
          validFrom: "Jan 1 00:00:00 2026 GMT",
          validTo: "Jan 1 00:00:00 2027 GMT",
        },
        headers: {
          "content-type": "text/html",
          "content-security-policy": "default-src 'self'",
          "set-cookie": ["session=secret; HttpOnly"],
        },
      };
    };

    const result = await probeHttpTarget("https://example.com", {
      resolver: publicResolver,
      requester,
    });

    expect(result).toMatchObject({
      ok: true,
      finalUrl: "https://example.com/",
      statusCode: 200,
      durationMs: 42,
    });
    if (!result.ok) {
      throw new Error("Expected successful HTTP probe");
    }

    expect(result.headers).toEqual({
      "content-security-policy": "default-src 'self'",
      "content-type": "text/html",
    });
    expect(result.headers).not.toHaveProperty("set-cookie");
    expect(
      result.securityHeaders.find(
        (item) => item.name === "content-security-policy",
      ),
    ).toMatchObject({ expected: true, present: true });
  });

  it("collects cookie attributes in Deep without persisting cookie values", async () => {
    const result = await probeHttpTarget("https://example.com", {
      resolver: publicResolver,
      collectDeepMetadata: true,
      requester: async () => ({
        statusCode: 200,
        durationMs: 1,
        tls: null,
        headers: {
          "set-cookie": [
            "__Host-session=secret=value; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600",
            "prefs=private; Domain=example.com; Expires=Wed, 21 Oct 2030 07:28:00 GMT",
          ],
        },
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      cookies: [
        {
          name: "__Host-session",
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
          path: "/",
          maxAge: "3600",
        },
        {
          name: "prefs",
          domain: "example.com",
          expires: "Wed, 21 Oct 2030 07:28:00 GMT",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("secret=value");
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("revalidates redirects while redacting query strings from results", async () => {
    const requestedHosts: string[] = [];
    const requestedUrls: string[] = [];
    const requester: HttpRequester = async (target) => {
      requestedHosts.push(target.hostname);
      requestedUrls.push(target.url.toString());
      if (target.hostname === "example.com") {
        return {
          statusCode: 302,
          durationMs: 10,
          tls: null,
          headers: {
            location: "https://redirect.example/final?token=secret#fragment",
          },
        };
      }
      return {
        statusCode: 200,
        durationMs: 15,
        tls: null,
        headers: { "content-type": "text/html" },
      };
    };

    const result = await probeHttpTarget("https://example.com/start", {
      resolver: publicResolver,
      requester,
    });

    expect(requestedHosts).toEqual(["example.com", "redirect.example"]);
    expect(requestedUrls[1]).toContain("?token=secret");
    expect(result).toMatchObject({
      ok: true,
      finalUrl: "https://redirect.example/final",
      durationMs: 25,
      redirects: [
        {
          statusCode: 302,
          from: "https://example.com/start",
          to: "https://redirect.example/final",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("token=secret");
  });
  it("rejects an unsafe redirect before a second connection", async () => {
    let requestCount = 0;
    const requester: HttpRequester = async () => {
      requestCount += 1;
      return {
        statusCode: 302,
        durationMs: 5,
        tls: null,
        headers: { location: "http://127.0.0.1/private" },
      };
    };

    await expect(
      probeHttpTarget("https://example.com", {
        resolver: publicResolver,
        requester,
      }),
    ).rejects.toMatchObject({ code: "non-public-ip" });

    expect(requestCount).toBe(1);
  });

  it("classifies request timeouts without leaking raw errors", async () => {
    const requester: HttpRequester = async () => {
      const error = new Error(
        "secret upstream detail",
      ) as NodeJS.ErrnoException;
      error.code = "ETIMEDOUT";
      throw error;
    };
    const result = await probeHttpTarget("https://example.com", {
      resolver: publicResolver,
      requester,
    });

    expect(result).toEqual({
      ok: false,
      targetUrl: "https://example.com/",
      redirects: [],
      error: { kind: "timeout", code: "ETIMEDOUT" },
    });
    expect(JSON.stringify(result)).not.toContain("secret upstream detail");
  });

  it("stops after the configured redirect limit", async () => {
    const requester: HttpRequester = async (target) => ({
      statusCode: 302,
      durationMs: 1,
      tls: null,
      headers: { location: target.url.toString() },
    });

    const result = await probeHttpTarget("https://example.com", {
      resolver: publicResolver,
      requester,
      maxRedirects: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "redirect", code: "TOO_MANY_REDIRECTS" },
    });
  });
});

describe("probe failure classification", () => {
  it("classifies certificate failures as TLS errors", async () => {
    const requester: HttpRequester = async () => {
      const error = new Error("certificate detail") as NodeJS.ErrnoException;
      error.code = "CERT_NOT_YET_VALID";
      throw error;
    };

    const result = await probeHttpTarget("https://example.com", {
      resolver: publicResolver,
      requester,
    });

    expect(result).toEqual({
      ok: false,
      targetUrl: "https://example.com/",
      redirects: [],
      error: { kind: "tls", code: "CERT_NOT_YET_VALID" },
    });
  });
});
