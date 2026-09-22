import { z } from "zod";

export const WeeklyScanDaySchema = z.number().int().min(1).max(7);
export const WeeklyScanMinuteOfDaySchema = z.number().int().min(0).max(1439);

export const TimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA time zone");

export const WeeklyScanScheduleInputSchema = z.object({
  enabled: z.boolean().default(true),
  dayOfWeek: WeeklyScanDaySchema,
  minuteOfDay: WeeklyScanMinuteOfDaySchema,
  timeZone: TimeZoneSchema.default("Europe/Paris"),
});

export type WeeklyScanScheduleInput = z.input<
  typeof WeeklyScanScheduleInputSchema
>;
export type WeeklyScanSchedule = z.output<typeof WeeklyScanScheduleInputSchema>;
