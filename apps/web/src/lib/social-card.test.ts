import { describe, expect, it } from "vitest";
import { createSocialCard, socialCardSize } from "./social-card";

describe("WebProbe social sharing image", () => {
  it("renders a public 1200x630 PNG without external resources", async () => {
    const response = createSocialCard();
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("cache-control")).toContain("public");
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(socialCardSize.width);
    expect(png.readUInt32BE(20)).toBe(socialCardSize.height);
    expect(png.byteLength).toBeGreaterThan(10000);
  });
});
