CREATE TABLE "pack_handoffs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"from_agent_actor_id" uuid NOT NULL,
	"to_agent_actor_id" uuid NOT NULL,
	"requested_by_actor_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" text NOT NULL,
	"requested_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_run_id" uuid,
	"target_run_id" uuid,
	"task_id" uuid,
	"mission_id" uuid,
	"room_id" uuid,
	"approval_id" uuid,
	"blocked_reason" text,
	"decided_by_actor_id" uuid,
	"decided_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_handoffs_status_check" CHECK ("pack_handoffs"."status" in ('pending','awaiting_approval','accepted','rejected','blocked','dispatched','cancelled')),
	CONSTRAINT "pack_handoffs_reason_check" CHECK ("pack_handoffs"."reason" in ('triage','hunt','research','reporting','response')),
	CONSTRAINT "pack_handoffs_distinct_agents_check" CHECK ("pack_handoffs"."from_agent_actor_id" <> "pack_handoffs"."to_agent_actor_id")
);
--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_from_agent_actor_id_actors_id_fk" FOREIGN KEY ("from_agent_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_to_agent_actor_id_actors_id_fk" FOREIGN KEY ("to_agent_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_requested_by_actor_id_actors_id_fk" FOREIGN KEY ("requested_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_target_run_id_agent_runs_id_fk" FOREIGN KEY ("target_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_mission_id_governed_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."governed_missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_decided_by_actor_id_actors_id_fk" FOREIGN KEY ("decided_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_from_agent_org_fk" FOREIGN KEY ("from_agent_actor_id","organisation_id") REFERENCES "public"."actors"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_to_agent_org_fk" FOREIGN KEY ("to_agent_actor_id","organisation_id") REFERENCES "public"."actors"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_handoffs" ADD CONSTRAINT "pack_handoffs_requester_org_fk" FOREIGN KEY ("requested_by_actor_id","organisation_id") REFERENCES "public"."actors"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pack_handoffs_org_idempotency_unique" ON "pack_handoffs" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "pack_handoffs_org_status_idx" ON "pack_handoffs" USING btree ("organisation_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "pack_handoffs_org_task_idx" ON "pack_handoffs" USING btree ("organisation_id","task_id","created_at");--> statement-breakpoint
CREATE INDEX "pack_handoffs_org_mission_idx" ON "pack_handoffs" USING btree ("organisation_id","mission_id","created_at");--> statement-breakpoint
-- Backfill: anyone already trusted to invoke an agent may request a governed
-- pack handoff. Idempotent, and never widens anything beyond agents.invoke.
UPDATE "actors"
SET "capability_assignments" = "capability_assignments" || '["agents.handoff"]'::jsonb
WHERE "capability_assignments" @> '["agents.invoke"]'::jsonb
  AND NOT ("capability_assignments" @> '["agents.handoff"]'::jsonb);