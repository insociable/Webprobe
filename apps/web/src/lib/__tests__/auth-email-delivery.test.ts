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
    const context = { setStatus: vi.fn() };

    await expect(
      deliverAuthOtpEmail(
        {
          email: "user@example.invalid",
          otp: "123456",
          type: "sign-in",
        },
        context,
      ),
    ).resolves.toBeUndefined();

    expect(mocks.sendAuthOtpEmail).toHaveBeenCalledOnce();
    expect(context.setStatus).not.toHaveBeenCalled();
  });

  it("marks the response unavailable and propagates SMTP failure", async () => {
    const failure = new Error("smtp unavailable");
    mocks.sendAuthOtpEmail.mockRejectedValue(failure);
    const context = { setStatus: vi.fn() };

    await expect(
      deliverAuthOtpEmail(
        {
          email: "user@example.invalid",
          otp: "123456",
          type: "sign-in",
        },
        context,
      ),
    ).rejects.toBe(failure);

    expect(context.setStatus).toHaveBeenCalledOnce();
    expect(context.setStatus).toHaveBeenCalledWith(503);
    expect(console.error).toHaveBeenCalledWith(
      "Authentication email delivery failed",
    );
  });
});
