CREATE TABLE "agent_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_policies_kind_check" CHECK ("agent_policies"."kind" in ('model','memory','tool','escalation')),
	CONSTRAINT "agent_policies_state_check" CHECK ("agent_policies"."state" in ('draft','active','retired'))
);
--> statement-breakpoint
CREATE TABLE "agent_profile_evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"profile_version_id" uuid NOT NULL,
	"evaluator_actor_id" uuid NOT NULL,
	"suite" text NOT NULL,
	"passed" boolean NOT NULL,
	"score" integer NOT NULL,
	"baseline_score" integer,
	"regressions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_profile_evaluations_score_check" CHECK ("agent_profile_evaluations"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "agent_profile_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"based_on_version_id" uuid,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"avatar_asset_id" text,
	"role" text NOT NULL,
	"operating_instructions" text NOT NULL,
	"communication_style" text NOT NULL,
	"example_prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_policy_id" uuid,
	"memory_policy_id" uuid,
	"tool_policy_id" uuid,
	"escalation_policy_id" uuid,
	"skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"channel_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"change_rationale" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"approved_by_actor_id" uuid,
	"approved_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_profile_versions_state_check" CHECK ("agent_profile_versions"."state" in ('draft','approved','active','retired')),
	CONSTRAINT "agent_profile_versions_self_approval_check" CHECK ("agent_profile_versions"."approved_by_actor_id" is null or "agent_profile_versions"."approved_by_actor_id" <> "agent_profile_versions"."created_by_actor_id")
);
--> statement-breakpoint
ALTER TABLE "agent_definitions" ADD COLUMN "active_profile_version_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "agent_profile_version_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_agent_id_agent_definitions_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_evaluations" ADD CONSTRAINT "agent_profile_evaluations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_evaluations" ADD CONSTRAINT "agent_profile_evaluations_profile_version_id_agent_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."agent_profile_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_evaluations" ADD CONSTRAINT "agent_profile_evaluations_evaluator_actor_id_actors_id_fk" FOREIGN KEY ("evaluator_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_agent_id_agent_definitions_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_model_policy_id_agent_policies_id_fk" FOREIGN KEY ("model_policy_id") REFERENCES "public"."agent_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_memory_policy_id_agent_policies_id_fk" FOREIGN KEY ("memory_policy_id") REFERENCES "public"."agent_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_tool_policy_id_agent_policies_id_fk" FOREIGN KEY ("tool_policy_id") REFERENCES "public"."agent_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_escalation_policy_id_agent_policies_id_fk" FOREIGN KEY ("escalation_policy_id") REFERENCES "public"."agent_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profile_versions" ADD CONSTRAINT "agent_profile_versions_approved_by_actor_id_actors_id_fk" FOREIGN KEY ("approved_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_policies_agent_kind_version_unique" ON "agent_policies" USING btree ("agent_id","kind","version");--> statement-breakpoint
CREATE INDEX "agent_policies_org_agent_kind_idx" ON "agent_policies" USING btree ("organisation_id","agent_id","kind");--> statement-breakpoint
CREATE INDEX "agent_profile_evaluations_version_idx" ON "agent_profile_evaluations" USING btree ("organisation_id","profile_version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profile_versions_agent_version_unique" ON "agent_profile_versions" USING btree ("agent_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profile_versions_agent_active_unique" ON "agent_profile_versions" USING btree ("agent_id") WHERE "agent_profile_versions"."state" = 'active';--> statement-breakpoint
CREATE INDEX "agent_profile_versions_org_agent_idx" ON "agent_profile_versions" USING btree ("organisation_id","agent_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_profile_version_id_agent_profile_versions_id_fk" FOREIGN KEY ("agent_profile_version_id") REFERENCES "public"."agent_profile_versions"("id") ON DELETE no action ON UPDATE no action;