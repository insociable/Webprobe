"use server";

import { OrganizationReadSchema } from "@agency-saas/contracts";
import { revalidatePath } from "next/cache";
import { requireCurrentSession } from "@/lib/current-session";
import {
  confirmSiteImport,
  MAX_CSV_BYTES,
  previewSiteImport,
  type SiteImportRow,
} from "@/lib/site-csv-import";

export type ImportActionState = {
  error: string | null;
  source: string | null;
  rows: SiteImportRow[];
  result: { imported: number; skipped: number } | null;
};

export const initialImportState: ImportActionState = {
  error: null,
  source: null,
  rows: [],
  result: null,
};

export async function importSitesAction(
  organizationId: string,
  _state: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  if (!OrganizationReadSchema.shape.id.safeParse(organizationId).success) {
    return { ...initialImportState, error: "Organisation invalide." };
  }
  const session = await requireCurrentSession();
  const mode = formData.get("mode");
  let source: string;
  if (mode === "preview") {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size > MAX_CSV_BYTES) {
      return {
        ...initialImportState,
        error: "Choisissez un CSV de 512 Ko maximum.",
      };
    }
    source = await file.text();
  } else if (mode === "confirm" && formData.get("confirm") === "yes") {
    const value = formData.get("source");
    if (
      typeof value !== "string" ||
      Buffer.byteLength(value, "utf8") > MAX_CSV_BYTES
    ) {
      return {
        ...initialImportState,
        error: "Aperçu expiré ou CSV trop volumineux. Recommencez.",
      };
    }
    source = value;
  } else {
    return { ...initialImportState, error: "Confirmation explicite requise." };
  }
  try {
    const rows = await previewSiteImport(
      session.user.id,
      organizationId,
      source,
    );
    if (mode === "preview") return { error: null, source, rows, result: null };
    const result = await confirmSiteImport(
      session.user.id,
      organizationId,
      source,
    );
    revalidatePath("/sites");
    revalidatePath("/dashboard");
    return { error: null, source: null, rows: [], result };
  } catch (error) {
    return {
      error:
        error instanceof Error &&
        /^(Le fichier|La première|Le CSV|Le fichier|Guillemet|Guillemets|Texte inattendu|Corrigez)/.test(
          error.message,
        )
          ? error.message
          : "Import impossible. Vérifiez vos droits, les données et les doublons, puis réessayez.",
      source: null,
      rows: [],
      result: null,
    };
  }
}
