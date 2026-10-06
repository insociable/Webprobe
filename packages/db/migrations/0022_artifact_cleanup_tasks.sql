CREATE TABLE "artifact_cleanup_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_cleanup_tasks_attempts_nonnegative" CHECK ("artifact_cleanup_tasks"."attempts" >= 0),
	CONSTRAINT "artifact_cleanup_tasks_storage_key_format" CHECK ("artifact_cleanup_tasks"."storage_key" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/primary[.]jpg$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_cleanup_tasks_storage_key_unique" ON "artifact_cleanup_tasks" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "artifact_cleanup_tasks_due_idx" ON "artifact_cleanup_tasks" USING btree ("next_attempt_at","id");