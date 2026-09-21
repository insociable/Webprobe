import { z } from "zod";

export const SCAN_QUEUE_NAME = "site-scan";

export const SeveritySchema = z.enum([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingCategorySchema = z.enum([
  "availability",
  "broken-link",
  "javascript",
  "tls",
  "security-header",
  "accessibility",
  "performance",
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const ScanProfileSchema = z.object({
  maxPages: z.number().int().min(1).max(100).default(20),
  navigationTimeoutMs: z.number().int().min(1_000).max(60_000).default(20_000),
  checkAccessibility: z.boolean().default(true),
  captureScreenshots: z.boolean().default(true),
});
export type ScanProfile = z.infer<typeof ScanProfileSchema>;

export const ScanJobSchema = z.object({
  scanId: z.string().uuid(),
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  targetUrl: z.string().url(),
  profile: ScanProfileSchema.default({
    maxPages: 20,
    navigationTimeoutMs: 20_000,
    checkAccessibility: true,
    captureScreenshots: true,
  }),
});
export type ScanJob = z.infer<typeof ScanJobSchema>;

export const ScanResultSchema = z.object({
  scanId: z.string().uuid(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  status: z.enum(["completed", "failed"]),
  pagesVisited: z.number().int().nonnegative(),
  findings: z.array(
    z.object({
      category: FindingCategorySchema,
      severity: SeveritySchema,
      code: z.string().min(1).max(120),
      title: z.string().min(1).max(240),
      pageUrl: z.string().url().optional(),
      evidence: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
});
export type ScanResult = z.infer<typeof ScanResultSchema>;
