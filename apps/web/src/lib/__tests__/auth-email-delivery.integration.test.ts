import { randomUUID } from "node:crypto";
import { authVerifications } from "@agency-saas/db";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendAuthOtpEmail: vi.fn(),
}));

vi.mock("../email", () => ({
  sendAuthOtpEmail: mocks.sendAuthOtpEmail,
}));

import { auth } from "../auth";
import { db } from "../database";

const describeDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeDatabase("auth OTP delivery HTTP semantics", () => {
  it("returns 503 when the OTP email cannot be delivered", async () => {
    const baseUrl = process.env.BETTER_AUTH_URL?.trim();
    if (!baseUrl) throw new Error("BETTER_AUTH_URL is required");

    const email = `otp-failure-${randomUUID()}@example.invalid`;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.sendAuthOtpEmail.mockRejectedValueOnce(new Error("smtp unavailable"));
    try {
      const response = await auth.handler(
        new Request(`${baseUrl}/api/auth/email-otp/send-verification-otp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: new URL(baseUrl).origin,
          },
          body: JSON.stringify({ email, type: "sign-in" }),
        }),
      );

      expect(response.status).toBe(503);
      expect(mocks.sendAuthOtpEmail).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
      await db
        .delete(authVerifications)
        .where(eq(authVerifications.identifier, `sign-in-otp-${email}`));
    }
  });
});
