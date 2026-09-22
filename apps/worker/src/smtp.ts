import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | undefined;

function smtpPort(): number {
  const value =
    process.env.SMTP_PORT ?? process.env.MAILPIT_SMTP_PORT ?? "1025";
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port");
  }

  return port;
}

export function getSmtpTransporter(): Transporter {
  if (transporter) {
    return transporter;
  }

  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "127.0.0.1",
    port: smtpPort(),
    secure: process.env.SMTP_SECURE === "true",
    ...(smtpUser && smtpPassword
      ? { auth: { user: smtpUser, pass: smtpPassword } }
      : {}),
  });

  return transporter;
}
