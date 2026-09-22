import { z } from "zod";

export const ReportBrandingInputSchema = z.object({
  brandName: z
    .string()
    .trim()
    .max(80)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable(),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .transform((value) => value.toLowerCase()),
});

export const ReportRecipientEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

export type ReportBrandingInput = z.infer<typeof ReportBrandingInputSchema>;
