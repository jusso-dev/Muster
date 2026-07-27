CREATE TABLE "report_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"requested_by_actor_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"status" text DEFAULT 'awaiting_approval' NOT NULL,
	"result" jsonb,
	"idempotency_key" text NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_deliveries_status_check" CHECK ("report_deliveries"."status" in ('awaiting_approval','queued','delivered','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "report_manifests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"task_id" uuid,
	"room_id" uuid NOT NULL,
	"requested_by_actor_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"manifest" jsonb NOT NULL,
	"classification" text DEFAULT 'internal' NOT NULL,
	"review_note" text,
	"posted_message_id" uuid,
	"idempotency_key" text NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_manifests_status_check" CHECK ("report_manifests"."status" in ('draft','reviewed','posted','superseded')),
	CONSTRAINT "report_manifests_version_check" CHECK ("report_manifests"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_report_id_report_manifests_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report_manifests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_requested_by_actor_id_actors_id_fk" FOREIGN KEY ("requested_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_manifests" ADD CONSTRAINT "report_manifests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_manifests" ADD CONSTRAINT "report_manifests_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_manifests" ADD CONSTRAINT "report_manifests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_manifests" ADD CONSTRAINT "report_manifests_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_manifests" ADD CONSTRAINT "report_manifests_requested_by_actor_id_actors_id_fk" FOREIGN KEY ("requested_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_manifests" ADD CONSTRAINT "report_manifests_posted_message_id_messages_id_fk" FOREIGN KEY ("posted_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_deliveries_org_idempotency_unique" ON "report_deliveries" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "report_deliveries_org_report_status_idx" ON "report_deliveries" USING btree ("organisation_id","report_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "report_manifests_org_idempotency_unique" ON "report_manifests" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "report_manifests_org_room_status_idx" ON "report_manifests" USING btree ("organisation_id","room_id","status","created_at");