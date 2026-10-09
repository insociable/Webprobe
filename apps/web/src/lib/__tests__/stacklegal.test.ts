import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const valid = (
  id: string,
  verification = "verified",
  missing: string[] = [],
) => ({
  apiVersion: "1",
  provider: {
    id,
    name: "Provider",
    legalName: "Provider Inc.",
    category: "analytics",
    purpose: "Measure use",
    location: "EU",
    transfer: [],
    dpfStatus: "unknown",
    officialUrl: "https://example.com/dpa",
    officialUrlKind: "dpa",
    pageUrl: `https://stacklegal.eu/rgpd/${id}`,
    lastVerified: "2026-10-04",
    verification,
    missing,
    aliases: [],
  },
});

describe("StackLégal server client", () => {
  beforeEach(() => vi.resetModules());

  it("accepts verified, partial and unverified without inventing missing fields", async () => {
    const { parseStackLegalProvider } = await import("../stacklegal");
    expect(
      parseStackLegalProvider(valid("vercel"), "vercel")?.verification,
    ).toBe("verified");
    expect(
      parseStackLegalProvider(
        valid("sentry", "partial", ["transfer"]),
        "sentry",
      )?.missing,
    ).toEqual(["transfer"]);
    expect(
      parseStackLegalProvider(
        valid("stripe", "unverified", ["location"]),
        "stripe",
      )?.verification,
    ).toBe("unverified");
  });

  it("rejects wrong versions, IDs, invalid URLs and malformed JSON shapes", async () => {
    const { parseStackLegalProvider } = await import("../stacklegal");
    expect(
      parseStackLegalProvider(
        { ...valid("vercel"), apiVersion: "2" },
        "vercel",
      ),
    ).toBeNull();
    expect(parseStackLegalProvider(valid("stripe"), "vercel")).toBeNull();
    expect(
      parseStackLegalProvider(
        {
          ...valid("vercel"),
          provider: {
            ...valid("vercel").provider,
            officialUrl: "http://example.com",
          },
        },
        "vercel",
      ),
    ).toBeNull();
    expect(
      parseStackLegalProvider(
        {
          ...valid("vercel"),
          provider: {
            ...valid("vercel").provider,
            pageUrl: "https://evil.test/",
          },
        },
        "vercel",
      ),
    ).toBeNull();
    expect(parseStackLegalProvider({ provider: {} }, "vercel")).toBeNull();
  });

  it("uses only the fixed origin and a validated slug", async () => {
    const { fetchStackLegalProvider } = await import("../stacklegal");
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      expect(url).toBe("https://stacklegal.eu/api/v1/providers/vercel");
      return new Response(JSON.stringify(valid("vercel")), {
        headers: { "content-type": "application/json" },
      });
    });
    expect((await fetchStackLegalProvider("vercel", fetcher))?.id).toBe(
      "vercel",
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://stacklegal.eu/api/v1/providers/vercel",
    );
    expect(
      await fetchStackLegalProvider("evil/path" as "vercel", fetcher),
    ).toBeNull();
  });

  it("degrades on HTTP 500, invalid JSON, oversized response and timeout", async () => {
    const { fetchStackLegalProvider } = await import("../stacklegal");
    const error = vi.fn(async () => new Response("failure", { status: 500 }));
    expect(await fetchStackLegalProvider("stripe", error)).toBeNull();
    const invalid = vi.fn(
      async () =>
        new Response("{", { headers: { "content-type": "application/json" } }),
    );
    expect(await fetchStackLegalProvider("stripe", invalid)).toBeNull();
    const large = vi.fn(
      async () =>
        new Response("{}", {
          headers: {
            "content-type": "application/json",
            "content-length": "100000",
          },
        }),
    );
    expect(await fetchStackLegalProvider("stripe", large)).toBeNull();
    const timeout = vi.fn(async () => {
      throw new DOMException("Timed out", "TimeoutError");
    });
    expect(await fetchStackLegalProvider("stripe", timeout)).toBeNull();
  });

  it("rejects unknown providers and an oversized streamed body", async () => {
    const { fetchStackLegalProvider } = await import("../stacklegal");
    expect(
      await fetchStackLegalProvider(
        "hotjar",
        async () => new Response("{}", { status: 404 }),
      ),
    ).toBeNull();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(70_000));
        controller.close();
      },
    });
    expect(
      await fetchStackLegalProvider(
        "hotjar",
        async () =>
          new Response(oversized, {
            headers: { "content-type": "application/json" },
          }),
      ),
    ).toBeNull();
  });
});
