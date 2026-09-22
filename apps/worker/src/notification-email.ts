import type { ClaimedNotificationDelivery } from "./notification-delivery.js";
import { getSmtpTransporter } from "./smtp.js";

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

    await getSmtpTransporter().sendMail({
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

  await getSmtpTransporter().sendMail({
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
