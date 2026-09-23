import nodemailer from "nodemailer";

function smtpPort(): number {
  const value =
    process.env.SMTP_PORT ?? process.env.MAILPIT_SMTP_PORT ?? "1025";
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port");
  }
  return port;
}

const smtpUser = process.env.SMTP_USER;
const smtpPassword = process.env.SMTP_PASSWORD;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "127.0.0.1",
  port: smtpPort(),
  secure: process.env.SMTP_SECURE === "true",
  ...(smtpUser && smtpPassword
    ? { auth: { user: smtpUser, pass: smtpPassword } }
    : {}),
});

export async function sendAuthOtpEmail(input: {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification" | "forget-password" | "change-email";
}): Promise<void> {
  const subject =
    input.type === "sign-in"
      ? "Votre code de connexion WebProbe"
      : "Votre code de vérification WebProbe";

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "no-reply@agency-monitor.local",
    to: input.email,
    subject,
    text: `Votre code est : ${input.otp}\n\nCe code expire dans 5 minutes.\n`,
  });
}
