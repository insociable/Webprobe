import nodemailer, { type Transporter } from "nodemailer";
import type { ClaimedNotificationDelivery } from "./notification-delivery.js";

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

function getTransporter(): Transporter {
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

function severityLabel(value: string): string {
  return value.toUpperCase();
}

function changeLabel(value: "new" | "worsened"): string {
  return value === "new" ? "nouveau" : "aggravé";
}

function scanDate(delivery: ClaimedNotificationDelivery): string {
  return delivery.completedAt
    ? new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Paris",
      }).format(delivery.completedAt)
    : "date inconnue";
}

export async function sendScanNotificationEmail(
  delivery: ClaimedNotificationDelivery,
): Promise<void> {
  if (delivery.kind === "scan-degradation") {
    const lines = delivery.payload.degradations.flatMap((item) => [
      `- [${severityLabel(item.severity)}] ${item.title} (${changeLabel(item.change)})`,
      `  ${item.pageUrl}`,
    ]);

    await getTransporter().sendMail({
      from: process.env.SMTP_FROM ?? "no-reply@agency-monitor.local",
      to: delivery.recipientEmail,
      messageId: `<agency-monitor-${delivery.kind}-${delivery.scanId}-${delivery.recipientUserId}@agency-monitor.local>`,
      subject: `[Agency Monitor] Dégradation détectée — ${delivery.siteName}`,
      text: [
        `Agency Monitor a détecté ${delivery.payload.degradations.length} dégradation(s) sur ${delivery.siteName}.`,
        "",
        `Site : ${delivery.siteUrl}`,
        `Scan : ${scanDate(delivery)}`,
        "",
        ...lines,
        "",
        "Consultez Agency Monitor pour le détail complet du scan.",
      ].join("\n"),
    });
    return;
  }

  const lines = delivery.payload.resolved.flatMap((item) => [
    `- [${severityLabel(item.severity)}] ${item.title} (résolu)`,
    `  ${item.pageUrl}`,
  ]);

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? "no-reply@agency-monitor.local",
    to: delivery.recipientEmail,
    messageId: `<agency-monitor-${delivery.kind}-${delivery.scanId}-${delivery.recipientUserId}@agency-monitor.local>`,
    subject: `[Agency Monitor] Rétablissement détecté — ${delivery.siteName}`,
    text: [
      `Agency Monitor a détecté le rétablissement de ${delivery.payload.resolved.length} incident(s) sur ${delivery.siteName}.`,
      "",
      `Site : ${delivery.siteUrl}`,
      `Scan : ${scanDate(delivery)}`,
      "",
      ...lines,
      "",
      "Consultez Agency Monitor pour le détail complet du scan.",
    ].join("\n"),
  });
}
