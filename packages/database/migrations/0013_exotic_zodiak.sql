CREATE TABLE "hunt_queries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"hunt_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"query_run_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"display_name" text NOT NULL,
	"sequence" integer NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hunt_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"task_id" uuid,
	"source_message_id" uuid,
	"room_id" uuid NOT NULL,
	"linked_case_id" text,
	"requested_by_actor_id" uuid NOT NULL,
	"question" text NOT NULL,
	"training_mode" boolean DEFAULT false NOT NULL,
	"plan" jsonb NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"approval_id" uuid,
	"result" jsonb,
	"failure_code" text,
	"error" text,
	"idempotency_key" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hunt_runs_status_check" CHECK ("hunt_runs"."status" in ('planned','awaiting_approval','querying','analysing','completed','failed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "hunt_queries" ADD CONSTRAINT "hunt_queries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_queries" ADD CONSTRAINT "hunt_queries_hunt_id_hunt_runs_id_fk" FOREIGN KEY ("hunt_id") REFERENCES "public"."hunt_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_queries" ADD CONSTRAINT "hunt_queries_integration_id_integration_records_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_queries" ADD CONSTRAINT "hunt_queries_template_id_integration_query_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."integration_query_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_queries" ADD CONSTRAINT "hunt_queries_query_run_id_integration_query_runs_id_fk" FOREIGN KEY ("query_run_id") REFERENCES "public"."integration_query_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_runs" ADD CONSTRAINT "hunt_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_runs" ADD CONSTRAINT "hunt_runs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_runs" ADD CONSTRAINT "hunt_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_runs" ADD CONSTRAINT "hunt_runs_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_runs" ADD CONSTRAINT "hunt_runs_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_runs" ADD CONSTRAINT "hunt_runs_requested_by_actor_id_actors_id_fk" FOREIGN KEY ("requested_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_runs" ADD CONSTRAINT "hunt_runs_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hunt_queries_org_query_run_unique" ON "hunt_queries" USING btree ("organisation_id","query_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hunt_queries_org_hunt_sequence_unique" ON "hunt_queries" USING btree ("organisation_id","hunt_id","sequence");--> statement-breakpoint
CREATE INDEX "hunt_queries_org_hunt_idx" ON "hunt_queries" USING btree ("organisation_id","hunt_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "hunt_runs_org_idempotency_unique" ON "hunt_runs" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "hunt_runs_org_agent_run_unique" ON "hunt_runs" USING btree ("organisation_id","agent_run_id");--> statement-breakpoint
CREATE INDEX "hunt_runs_org_status_idx" ON "hunt_runs" USING btree ("organisation_id","status","created_at");