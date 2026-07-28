CREATE TABLE "governed_missions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"capability_envelope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schedule_hint" text,
	"cancellation_policy" jsonb DEFAULT '{"killSwitchBlocksNew":true}'::jsonb NOT NULL,
	"hermes_profile" text,
	"created_by_actor_id" uuid NOT NULL,
	"updated_by_actor_id" uuid,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governed_mission_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"hermes_installation_id" uuid,
	"hermes_profile" text,
	"initiating_actor_id" uuid NOT NULL,
	"delivery_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "governed_missions" ADD CONSTRAINT "governed_missions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governed_missions" ADD CONSTRAINT "governed_missions_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governed_missions" ADD CONSTRAINT "governed_missions_updated_by_actor_id_actors_id_fk" FOREIGN KEY ("updated_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governed_missions" ADD CONSTRAINT "governed_missions_creator_org_fk" FOREIGN KEY ("created_by_actor_id","organisation_id") REFERENCES "public"."actors"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governed_mission_runs" ADD CONSTRAINT "governed_mission_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governed_mission_runs" ADD CONSTRAINT "governed_mission_runs_mission_id_governed_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."governed_missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governed_mission_runs" ADD CONSTRAINT "governed_mission_runs_hermes_installation_id_mcp_installations_id_fk" FOREIGN KEY ("hermes_installation_id") REFERENCES "public"."mcp_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governed_mission_runs" ADD CONSTRAINT "governed_mission_runs_initiating_actor_id_actors_id_fk" FOREIGN KEY ("initiating_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "governed_missions_org_status_idx" ON "governed_missions" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "governed_missions_org_name_unique" ON "governed_missions" USING btree ("organisation_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "governed_mission_runs_org_idempotency_unique" ON "governed_mission_runs" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "governed_mission_runs_mission_idx" ON "governed_mission_runs" USING btree ("organisation_id","mission_id","created_at");--> statement-breakpoint
ALTER TABLE "governed_missions" ADD CONSTRAINT "governed_missions_status_check" CHECK ("status" in ('active','paused','cancelled','archived'));--> statement-breakpoint
ALTER TABLE "governed_mission_runs" ADD CONSTRAINT "governed_mission_runs_status_check" CHECK ("status" in ('accepted','blocked','running','succeeded','failed','cancelled'));
