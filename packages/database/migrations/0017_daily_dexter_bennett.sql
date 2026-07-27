ALTER TABLE "hunt_runs" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_records" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_manifests" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "research_watchlists" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "archived_at" timestamp with time zone;