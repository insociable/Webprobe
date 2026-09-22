import { z } from "zod";

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export const OrganizationNameSchema = z
  .string()
  .transform(normalizedName)
  .pipe(z.string().min(2).max(120));

export const OrganizationCreateSchema = z.object({
  name: OrganizationNameSchema,
});

export const OrganizationReadSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type OrganizationCreate = z.infer<typeof OrganizationCreateSchema>;
export type OrganizationRead = z.infer<typeof OrganizationReadSchema>;

export const SiteNameSchema = z
  .string()
  .transform(normalizedName)
  .pipe(z.string().min(2).max(160));
export function normalizeCanonicalSiteUrl(rawValue: string): string {
  const raw = rawValue.trim();
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error("Site URL must be an absolute URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Site URL must use HTTP or HTTPS");
  }

  if (url.username || url.password) {
    throw new Error("Site URL must not contain credentials");
  }

  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort) {
    throw new Error("Site URL must use the standard HTTP(S) port");
  }

  if (url.search || url.hash) {
    throw new Error("Site URL must not contain query parameters or fragments");
  }

  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  }

  return url.toString();
}

export const CanonicalSiteUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .transform((value, ctx) => {
    try {
      return normalizeCanonicalSiteUrl(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid site URL",
      });
      return z.NEVER;
    }
  });

export const SiteCreateSchema = z.object({
  name: SiteNameSchema,
  canonicalUrl: CanonicalSiteUrlSchema,
});
export const SiteReadSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  canonicalUrl: CanonicalSiteUrlSchema,
  status: z.enum(["pending_verification", "active", "paused"]),
  verifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SiteCreate = z.infer<typeof SiteCreateSchema>;
export type SiteRead = z.infer<typeof SiteReadSchema>;
