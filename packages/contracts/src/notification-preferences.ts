import { z } from "zod";

export const ScanAlertMinimumSeveritySchema = z.enum([
  "medium",
  "high",
  "critical",
]);

export const ScanAlertPreferenceInputSchema = z.object({
  enabled: z.boolean(),
  minimumSeverity: ScanAlertMinimumSeveritySchema,
});

export type ScanAlertMinimumSeverity = z.infer<
  typeof ScanAlertMinimumSeveritySchema
>;
export type ScanAlertPreferenceInput = z.infer<
  typeof ScanAlertPreferenceInputSchema
>;
