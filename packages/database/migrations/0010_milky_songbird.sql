CREATE TABLE "agent_readiness_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"process_identity" text NOT NULL,
	"gateway_state" text NOT NULL,
	"authentication_state" text NOT NULL,
	"observer_state" text NOT NULL,
	"lifecycle_evidence_state" text NOT NULL,
	"lifecycle_state" text NOT NULL,
	"capability_state" text NOT NULL,
	"tool_state" text NOT NULL,
	"permission_state" text NOT NULL,
	"reported_runtime" text NOT NULL,
	"reported_provider" text NOT NULL,
	"reported_model" text NOT NULL,
	"input_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"available_commands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_risk_classes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_permission_mode" text NOT NULL,
	"effective_permission_mode" text NOT NULL,
	"limitations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_definitions" ADD COLUMN "requested_permission_mode" text DEFAULT 'read_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_readiness_snapshots" ADD CONSTRAINT "agent_readiness_snapshots_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_readiness_snapshots" ADD CONSTRAINT "agent_readiness_snapshots_agent_id_agent_definitions_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_readiness_org_agent_verified_idx" ON "agent_readiness_snapshots" USING btree ("organisation_id","agent_id","verified_at");--> statement-breakpoint
CREATE INDEX "agent_readiness_org_process_verified_idx" ON "agent_readiness_snapshots" USING btree ("organisation_id","process_identity","verified_at");