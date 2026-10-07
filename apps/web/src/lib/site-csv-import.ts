import { SiteCreateSchema, type SiteCreate } from "@agency-saas/contracts";
import { siteImportEvents, sites } from "@agency-saas/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./database";
import {
  canManageOrganization,
  OrganizationAccessError,
  requireOrganizationAccess,
} from "./organization-site-service";
import { deriveSiteDisplayName } from "./site-display-name";

// Bound both parsing work and the number of rows submitted in one transaction.
export const MAX_CSV_BYTES = 512 * 1024;
export const MAX_CSV_ROWS = 500;

export type SiteImportRow = {
  line: number;
  url: string;
  name: string;
  status: "ready" | "invalid" | "duplicate-file" | "existing";
  reason: string | null;
};

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field !== "" || closedQuote)
        throw new Error("Guillemets CSV mal placés.");
      quoted = true;
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      closedQuote = false;
      if (char === ",") continue;
      if (char === "\r" && source[i + 1] === "\n") i++;
      rows.push(row);
      row = [];
      if (rows.length > MAX_CSV_ROWS + 1)
        throw new Error("Le CSV dépasse 500 sites.");
    } else {
      if (closedQuote)
        throw new Error("Texte inattendu après un guillemet CSV.");
      field += char;
    }
  }
  if (quoted) throw new Error("Guillemet CSV non fermé.");
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  if (rows.length > MAX_CSV_ROWS + 1)
    throw new Error("Le CSV dépasse 500 sites.");
  return rows;
}

export function parseSiteImportCsv(source: string): SiteImportRow[] {
  if (Buffer.byteLength(source, "utf8") > MAX_CSV_BYTES) {
    throw new Error("Le fichier CSV dépasse 512 Ko.");
  }
  const rows = parseCsv(source.replace(/^\uFEFF/, ""));
  if (
    rows.length === 0 ||
    rows[0]!.map((field) => field.trim().toLowerCase()).join(",") !== "url,name"
  ) {
    throw new Error("La première ligne doit être : url,name");
  }
  if (rows.length <= 1) throw new Error("Le fichier ne contient aucun site.");
  const seen = new Set<string>();
  return rows.slice(1).map((fields, index) => {
    const url = fields[0]?.trim() ?? "";
    const requestedName = fields[1]?.trim() ?? "";
    if (fields.length !== 2 || (!url && !requestedName)) {
      return {
        line: index + 2,
        url,
        name: requestedName,
        status: "invalid",
        reason: "Deux colonnes url,name sont attendues.",
      };
    }
    const parsedUrl = SiteCreateSchema.shape.canonicalUrl.safeParse(url);
    if (!parsedUrl.success) {
      return {
        line: index + 2,
        url,
        name: requestedName,
        status: "invalid",
        reason: parsedUrl.error.issues[0]?.message ?? "URL invalide.",
      };
    }
    const parsed = SiteCreateSchema.safeParse({
      canonicalUrl: parsedUrl.data,
      name: deriveSiteDisplayName(parsedUrl.data, requestedName || null),
    });
    if (!parsed.success) {
      return {
        line: index + 2,
        url,
        name: requestedName,
        status: "invalid",
        reason: parsed.error.issues[0]?.message ?? "Site invalide.",
      };
    }
    const data = parsed.data;
    if (seen.has(data.canonicalUrl)) {
      return {
        line: index + 2,
        url: data.canonicalUrl,
        name: data.name,
        status: "duplicate-file",
        reason: "Déjà présent dans ce fichier.",
      };
    }
    seen.add(data.canonicalUrl);
    return {
      line: index + 2,
      url: data.canonicalUrl,
      name: data.name,
      status: "ready",
      reason: null,
    };
  });
}

async function requireImporter(userId: string, organizationId: string) {
  const access = await requireOrganizationAccess(userId, organizationId);
  if (!canManageOrganization(access.role)) throw new OrganizationAccessError();
}

export async function previewSiteImport(
  userId: string,
  organizationId: string,
  source: string,
) {
  await requireImporter(userId, organizationId);
  const rows = parseSiteImportCsv(source);
  const urls = rows
    .filter((row) => row.status === "ready")
    .map((row) => row.url);
  if (urls.length === 0) return rows;
  const existing = await db
    .select({ url: sites.canonicalUrl })
    .from(sites)
    .where(
      and(
        eq(sites.organizationId, organizationId),
        inArray(sites.canonicalUrl, urls),
      ),
    );
  const existingUrls = new Set(existing.map((site) => site.url));
  return rows.map((row) =>
    row.status === "ready" && existingUrls.has(row.url)
      ? {
          ...row,
          status: "existing" as const,
          reason: "Déjà enregistré dans cette organisation.",
        }
      : row,
  );
}

export async function confirmSiteImport(
  userId: string,
  organizationId: string,
  source: string,
) {
  await requireImporter(userId, organizationId);
  return db.transaction(async (tx) => {
    // Recompute the preview under a transaction lock: the submitted CSV may have
    // changed, and a concurrent import must not cause a partial insertion.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${organizationId})::bigint)`,
    );
    const rows = parseSiteImportCsv(source);
    const ready = rows.filter((row) => row.status === "ready");
    if (rows.some((row) => row.status === "invalid"))
      throw new Error("Corrigez les lignes invalides avant de confirmer.");
    if (ready.length === 0) return { imported: 0, skipped: rows.length };
    const existing = await tx
      .select({ url: sites.canonicalUrl })
      .from(sites)
      .where(
        and(
          eq(sites.organizationId, organizationId),
          inArray(
            sites.canonicalUrl,
            ready.map((row) => row.url),
          ),
        ),
      );
    const existingUrls = new Set(existing.map((site) => site.url));
    const toCreate: SiteCreate[] = ready
      .filter((row) => !existingUrls.has(row.url))
      .map((row) => ({ canonicalUrl: row.url, name: row.name }));
    if (toCreate.length > 0) {
      await tx.insert(sites).values(
        toCreate.map((site) => ({
          organizationId,
          canonicalUrl: site.canonicalUrl,
          name: site.name,
          status: "pending_verification" as const,
        })),
      );
    }
    await tx.insert(siteImportEvents).values({
      organizationId,
      actorUserId: userId,
      importedCount: toCreate.length,
      skippedCount: rows.length - toCreate.length,
    });
    return {
      imported: toCreate.length,
      skipped: rows.length - toCreate.length,
    };
  });
}
