"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className={
        compact
          ? "am-button-secondary min-h-9 px-3 py-2 text-xs"
          : "am-button-secondary w-full"
      }
    >
      {compact ? "Quitter" : "Se déconnecter"}
    </button>
  );
}
