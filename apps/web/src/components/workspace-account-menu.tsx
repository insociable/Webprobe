import { requireCurrentSession } from "@/lib/current-session";
import { WorkspaceAccountMenuClient } from "./workspace-account-menu-client";

export async function WorkspaceAccountMenu() {
  const session = await requireCurrentSession();
  const emailFallbackName = session.user.email.split("@")[0] ?? "";
  const hasCustomDisplayName =
    session.user.name !== "Utilisateur" &&
    session.user.name.trim().toLowerCase() !==
      emailFallbackName.trim().toLowerCase();

  return (
    <WorkspaceAccountMenuClient
      displayName={hasCustomDisplayName ? session.user.name : ""}
      email={session.user.email}
    />
  );
}
