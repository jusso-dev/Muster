ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "recurrence_cadence" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "recurrence_timezone" text DEFAULT 'Australia/Sydney' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "recurrence_hour" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "next_occurrence_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "recurrence_source_task_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_org_next_occurrence_idx" ON "tasks" USING btree ("organisation_id","next_occurrence_at");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_cadence_check" CHECK ("recurrence_cadence" is null or "recurrence_cadence" in ('daily','weekly','weekdays'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
