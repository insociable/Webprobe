ALTER TABLE "scan_schedules" ADD COLUMN "next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_schedule_id_scan_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."scan_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scan_schedules_due_idx" ON "scan_schedules" USING btree ("next_run_at") WHERE "scan_schedules"."enabled" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "scans_schedule_occurrence_unique" ON "scans" USING btree ("schedule_id","scheduled_for") WHERE "scans"."trigger" = 'scheduled' and "scans"."schedule_id" is not null;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_scheduled_metadata_consistent" CHECK (("scans"."trigger" = 'manual' and "scans"."schedule_id" is null and "scans"."scheduled_for" is null)
          or ("scans"."trigger" = 'scheduled' and "scans"."scheduled_for" is not null));--> statement-breakpoint
CREATE FUNCTION public.next_weekly_scan_run(
  p_day_of_week integer,
  p_minute_of_day integer,
  p_time_zone text,
  p_after timestamp with time zone
)
RETURNS timestamp with time zone
LANGUAGE sql
STABLE
STRICT
AS $$
  WITH localized AS (
    SELECT p_after AT TIME ZONE p_time_zone AS local_after
  ),
  candidate AS (
    SELECT
      local_after,
      date_trunc('day', local_after)
        + ((((p_day_of_week - extract(isodow from local_after)::integer) + 7) % 7) * interval '1 day')
        + make_interval(mins => p_minute_of_day) AS local_candidate
    FROM localized
  )
  SELECT (
    CASE
      WHEN local_candidate > local_after THEN local_candidate
      ELSE local_candidate + interval '7 days'
    END
  ) AT TIME ZONE p_time_zone
  FROM candidate;
$$;
