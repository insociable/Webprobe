import { describe, expect, it } from "vitest";
import {
  assertPublicHttpUrl,
  isPublicIp,
  type DnsResolver,
} from "../src/index.js";

const publicResolver: DnsResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

describe("isPublicIp", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("rejects %s", (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "accepts %s",
    (address) => {
      expect(isPublicIp(address)).toBe(true);
    },
  );
});

describe("assertPublicHttpUrl", () => {
  it("accepts a public HTTPS target", async () => {
    const result = await assertPublicHttpUrl(
      "https://example.com/path",
      publicResolver,
    );
    expect(result.hostname).toBe("example.com");
    expect(result.addresses).toEqual(["93.184.216.34"]);
  });

  it.each([
    "ftp://example.com",
    "http://user:pass@example.com",
    "http://localhost",
    "http://example.local",
    "https://example.com:8443",
  ])("rejects forbidden URL %s", async (url) => {
    await expect(
      assertPublicHttpUrl(url, publicResolver),
    ).rejects.toBeInstanceOf(Error);
  });

  it("rejects a private literal address", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1")).rejects.toMatchObject(
      {
        code: "non-public-ip",
      },
    );
  });

  it("rejects mixed public and private DNS answers", async () => {
    const rebindingResolver: DnsResolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.10", family: 4 },
    ];

    await expect(
      assertPublicHttpUrl("https://example.com", rebindingResolver),
    ).rejects.toMatchObject({ code: "non-public-ip" });
  });
});
