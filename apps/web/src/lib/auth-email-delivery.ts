import { sendAuthOtpEmail } from "./email";

export type AuthOtpEmailInput = Parameters<typeof sendAuthOtpEmail>[0];

export async function deliverAuthOtpEmail(
  input: AuthOtpEmailInput,
): Promise<void> {
  try {
    await sendAuthOtpEmail(input);
  } catch (error) {
    console.error("Authentication email delivery failed");
    throw error;
  }
}
