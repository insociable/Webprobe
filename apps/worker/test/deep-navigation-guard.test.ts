import { describe, expect, it, vi } from "vitest";
import type { BrowserRequestPolicyInput } from "../src/browser-runtime.js";
import { createDeepNavigationGuard } from "../src/scan-engine/deep-navigation-guard.js";

function request(
  url: string,
  overrides: Partial<BrowserRequestPolicyInput> = {},
): BrowserRequestPolicyInput {
  return {
    url,
    method: "GET",
    resourceType: "document",
    isNavigationRequest: true,
    isMainFrameNavigation: true,
    redirectedFromUrl: null,
    ...overrides,
  };
}

function fixture(assertCurrent = vi.fn(async () => undefined)) {
  return createDeepNavigationGuard({
    canonicalUrl: "https://example.com/",
    allowedPathPrefixes: ["/blog/", "/about"],
    maxPages: 3,
    assertCurrent,
  });
}

describe("Deep navigation guard — not enabled by default", () => {
  it("rejects navigations unless deliberately armed", async () => {
    const guard = fixture();
    expect(await guard.authorizeRequest(request("https://example.com/"))).toBe(
      false,
    );
    const result = await guard.withNavigation(
      "https://example.com/",
      async () => {
        expect(
          await guard.authorizeRequest(request("https://example.com/")),
        ).toBe(true);
        return "entry";
      },
    );
    expect(result).toBe("entry");
    expect(await guard.authorizeRequest(request("https://example.com/"))).toBe(
      false,
    );
  });

  it("denies an internal or external redirect to a different URL", async () => {
    const guard = fixture();
    await guard.withNavigation("https://example.com/blog/post", async () => {
      expect(
        await guard.authorizeRequest(request("https://example.com/blog/post")),
      ).toBe(true);
      for (const url of [
        "https://example.com/blog/other",
        "https://example.com/about",
        "https://example.com/logout",
        "https://other.example.com/blog/post",
        "https://example.com/blog/post?token=secret",
        "https://example.com:8443/blog/post",
      ]) {
        expect(
          await guard.authorizeRequest(
            request(url, {
              redirectedFromUrl: "https://example.com/blog/post",
            }),
          ),
        ).toBe(false);
      }
      expect(
        await guard.authorizeRequest(
          request("https://example.com/blog/post", {
            redirectedFromUrl: "https://example.com/logout",
          }),
        ),
      ).toBe(false);
    });
  });

  it("denies scripted navigation, iframes, and unknown frames even when armed", async () => {
    const guard = fixture();
    await guard.withNavigation("https://example.com/", async () => {
      for (const changes of [
        { isMainFrameNavigation: false },
        { isMainFrameNavigation: undefined },
        { resourceType: "iframe" },
        { method: "POST" },
        { method: "PUT" },
        { isNavigationRequest: true, resourceType: "image" },
      ]) {
        expect(
          await guard.authorizeRequest(
            request("https://example.com/", changes),
          ),
        ).toBe(false);
      }
      // Subresources are subject to the existing network/proxy restrictions,
      // not the navigation allowlist.
      expect(
        await guard.authorizeRequest(
          request("https://example.com/style.css", {
            isNavigationRequest: false,
            resourceType: "stylesheet",
          }),
        ),
      ).toBe(true);
    });
    expect(
      await guard.authorizeRequest(request("https://example.com/blog/post")),
    ).toBe(false);
  });

  it("rejects unconsented, malformed or credential-bearing destinations", async () => {
    const guard = fixture();
    for (const url of [
      "https://example.com/",
      "https://example.com/blogs/post",
      "https://example.com/blog/post?preview=1",
      "https://example.com/blog/%2fadmin",
      "https://example.com/blog/.hidden",
      "https://example.com/admin",
      "https://username:password@example.com/blog/post",
      "https://other.example.com/blog/post",
      "http://example.com/blog/post",
      "file:///etc/passwd",
      "invalid URL",
    ]) {
      if (url === "https://example.com/") continue; // The approved entry page.
      await expect(guard.withNavigation(url, async () => true)).rejects.toThrow(
        /not authorized/,
      );
    }
  });

  it("never permits a spontaneous second page during an armed navigation", async () => {
    const guard = fixture();
    await guard.withNavigation("https://example.com/", async () => {
      await expect(
        guard.withNavigation(
          "https://example.com/blog/second",
          async () => true,
        ),
      ).rejects.toThrow(/not authorized/);
      expect(
        await guard.authorizeRequest(
          request("https://example.com/blog/second"),
        ),
      ).toBe(false);
    });
  });

  it("counts failed attempts toward the hard page budget", async () => {
    const guard = fixture();
    for (const url of [
      "https://example.com/",
      "https://example.com/blog/one",
      "https://example.com/blog/two",
    ]) {
      await expect(
        guard.withNavigation(url, async () => {
          throw new Error("Simulated network failure");
        }),
      ).rejects.toThrow(/Simulated network failure/);
    }
    await expect(
      guard.withNavigation("https://example.com/blog/three", async () => true),
    ).rejects.toThrow(/not authorized/);
  });

  it("checks current consent on every navigation and redirect, failing closed on revoke", async () => {
    let revoked = false;
    const assertCurrent = vi.fn(async () => {
      if (revoked) throw new Error("Lease or consent was revoked");
    });
    const guard = fixture(assertCurrent);
    await guard.withNavigation("https://example.com/", async () => {
      expect(
        await guard.authorizeRequest(request("https://example.com/")),
      ).toBe(true);
      revoked = true;
      expect(
        await guard.authorizeRequest(request("https://example.com/")),
      ).toBe(false);
    });
    await expect(
      guard.withNavigation("https://example.com/blog/one", async () => true),
    ).rejects.toThrow(/revoked/);
    expect(assertCurrent).toHaveBeenCalledTimes(4);
  });

  it("does not arm navigation if the initial consent check fails", async () => {
    const guard = fixture(async () => {
      throw new Error("expired");
    });
    await expect(
      guard.withNavigation("https://example.com/", async () => true),
    ).rejects.toThrow(/expired/);
    expect(await guard.authorizeRequest(request("https://example.com/"))).toBe(
      false,
    );
  });

  it("does not allow the input allowlist to expand after initialization", async () => {
    const allowedPathPrefixes = ["/blog/"];
    const guard = createDeepNavigationGuard({
      canonicalUrl: "https://example.com/",
      allowedPathPrefixes,
      maxPages: 2,
      assertCurrent: async () => undefined,
    });
    allowedPathPrefixes.push("/admin/", "/about");
    await expect(
      guard.withNavigation("https://example.com/about", async () => true),
    ).rejects.toThrow(/not authorized/);
  });

  it("validates its server-side configuration before use", () => {
    const common = {
      canonicalUrl: "https://example.com/",
      allowedPathPrefixes: ["/blog/"],
      maxPages: 2,
      assertCurrent: async () => undefined,
    };
    for (const config of [
      { allowedPathPrefixes: ["/"] },
      { allowedPathPrefixes: ["/admin/"] },
      { allowedPathPrefixes: ["/blog/", "/blog/"] },
      { maxPages: 1 },
      { maxPages: 6 },
      { canonicalUrl: "https://example.com/?token=secret" },
      { canonicalUrl: "https://attacker@example.com/" },
    ]) {
      expect(() =>
        createDeepNavigationGuard({ ...common, ...config }),
      ).toThrow();
    }
  });
});
