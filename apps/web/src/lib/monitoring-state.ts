export type MonitoringStateKey =
  | "active"
  | "inactive"
  | "verification_required"
  | "paused";

export type MonitoringState = {
  key: MonitoringStateKey;
  label: string;
  detail: string;
};

type MonitoringStateInput = {
  status: string;
  verifiedAt: Date | string | null;
  scheduleEnabled: boolean;
};

export function getMonitoringState({
  status,
  verifiedAt,
  scheduleEnabled,
}: MonitoringStateInput): MonitoringState {
  if (status === "paused") {
    return {
      key: "paused",
      label: "Monitoring en pause",
      detail:
        "Le site est vérifié, mais sa supervision est actuellement suspendue.",
    };
  }

  if (status === "active" && verifiedAt) {
    if (scheduleEnabled) {
      return {
        key: "active",
        label: "Monitoring actif",
        detail: "Le domaine est vérifié et le scan automatique est activé.",
      };
    }

    return {
      key: "inactive",
      label: "Monitoring inactif",
      detail:
        "Le domaine est vérifié, mais aucun scan automatique n’est actif.",
    };
  }

  return {
    key: "verification_required",
    label: "Vérification requise",
    detail:
      "Public Audit uniquement tant que le domaine n’est pas vérifié par DNS.",
  };
}
