"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function ScanStatusRefresher({
  active,
  status,
}: {
  active: boolean;
  status: string;
}) {
  const router = useRouter();
  const previousStatus = useRef(status);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (previousStatus.current === status) return;
    previousStatus.current = status;
    const label: Record<string, string> = {
      queued: "Scan en attente de démarrage",
      running: "Scan en cours d’analyse",
      completed: "Scan terminé, rapport disponible",
      failed: "Scan échoué",
      cancelled: "Scan annulé",
    };
    setAnnouncement(label[status] ?? "Statut du scan mis à jour");
  }, [status]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const interval = window.setInterval(() => {
      router.refresh();
    }, 3_000);

    return () => window.clearInterval(interval);
  }, [active, router]);

  return (
    <span role="status" className="sr-only">
      {announcement}
    </span>
  );
}
