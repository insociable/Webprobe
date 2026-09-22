import { sendAuthOtpEmail } from "./email";

export type AuthOtpEmailInput = Parameters<typeof sendAuthOtpEmail>[0];

type AuthOtpDeliveryContext = {
  setStatus(status: 503): void;
};

export async function deliverAuthOtpEmail(
  input: AuthOtpEmailInput,
  context?: AuthOtpDeliveryContext,
): Promise<void> {
  try {
    await sendAuthOtpEmail(input);
  } catch (error) {
    context?.setStatus(503);
    console.error("Authentication email delivery failed");
    throw error;
  }
}
