import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendAuthOtpEmail: vi.fn(),
}));

vi.mock("../email", () => ({
  sendAuthOtpEmail: mocks.sendAuthOtpEmail,
}));

import { deliverAuthOtpEmail } from "../auth-email-delivery";

describe("auth OTP email delivery", () => {
  beforeEach(() => {
    mocks.sendAuthOtpEmail.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("waits for successful SMTP delivery", async () => {
    mocks.sendAuthOtpEmail.mockResolvedValue(undefined);

    await expect(
      deliverAuthOtpEmail({
        email: "user@example.invalid",
        otp: "123456",
        type: "sign-in",
      }),
    ).resolves.toBeUndefined();

    expect(mocks.sendAuthOtpEmail).toHaveBeenCalledOnce();
  });

  it("propagates SMTP failure instead of reporting a false success", async () => {
    const failure = new Error("smtp unavailable");
    mocks.sendAuthOtpEmail.mockRejectedValue(failure);

    await expect(
      deliverAuthOtpEmail({
        email: "user@example.invalid",
        otp: "123456",
        type: "sign-in",
      }),
    ).rejects.toBe(failure);

    expect(console.error).toHaveBeenCalledWith(
      "Authentication email delivery failed",
    );
  });
});
