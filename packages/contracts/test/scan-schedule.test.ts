import { describe, expect, it } from "vitest";
import { WeeklyScanScheduleInputSchema } from "../src/scan-schedule.js";

describe("WeeklyScanScheduleInputSchema", () => {
  it("accepts a valid weekly schedule", () => {
    expect(
      WeeklyScanScheduleInputSchema.parse({
        dayOfWeek: 1,
        minuteOfDay: 9 * 60,
        timeZone: "Europe/Paris",
      }),
    ).toEqual({
      enabled: true,
      dayOfWeek: 1,
      minuteOfDay: 540,
      timeZone: "Europe/Paris",
    });
  });

  it.each([
    { dayOfWeek: 0, minuteOfDay: 540, timeZone: "Europe/Paris" },
    { dayOfWeek: 8, minuteOfDay: 540, timeZone: "Europe/Paris" },
    { dayOfWeek: 1, minuteOfDay: -1, timeZone: "Europe/Paris" },
    { dayOfWeek: 1, minuteOfDay: 1440, timeZone: "Europe/Paris" },
    { dayOfWeek: 1, minuteOfDay: 540, timeZone: "Mars/Olympus" },
  ])("rejects invalid schedule %#", (input) => {
    expect(() => WeeklyScanScheduleInputSchema.parse(input)).toThrow();
  });
});
