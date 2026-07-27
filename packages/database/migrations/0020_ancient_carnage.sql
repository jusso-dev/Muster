CREATE TABLE "slack_agent_exposures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"allowed_channel_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_direct_messages" boolean DEFAULT true NOT NULL,
	"allow_thread_context" boolean DEFAULT false NOT NULL,
	"updated_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_identity_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"slack_user_id" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "slack_inbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "slack_installations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text,
	"enterprise_id" text,
	"bot_user_id" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_bot_token" text NOT NULL,
	"encrypted_app_token" text,
	"status" text DEFAULT 'active' NOT NULL,
	"installed_by_actor_id" uuid NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_health_at" timestamp with time zone,
	"last_delivery_at" timestamp with time zone,
	"last_error" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_run_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"inbox_event_id" uuid,
	"channel_id" text NOT NULL,
	"thread_ts" text NOT NULL,
	"progress_message_ts" text,
	"result_message_ts" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"last_progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_agent_exposures" ADD CONSTRAINT "slack_agent_exposures_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_agent_exposures" ADD CONSTRAINT "slack_agent_exposures_installation_id_slack_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."slack_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_agent_exposures" ADD CONSTRAINT "slack_agent_exposures_agent_id_agent_definitions_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_agent_exposures" ADD CONSTRAINT "slack_agent_exposures_updated_by_actor_id_actors_id_fk" FOREIGN KEY ("updated_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_identity_mappings" ADD CONSTRAINT "slack_identity_mappings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_identity_mappings" ADD CONSTRAINT "slack_identity_mappings_installation_id_slack_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."slack_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_identity_mappings" ADD CONSTRAINT "slack_identity_mappings_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_identity_mappings" ADD CONSTRAINT "slack_identity_mappings_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_inbox_events" ADD CONSTRAINT "slack_inbox_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_inbox_events" ADD CONSTRAINT "slack_inbox_events_installation_id_slack_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."slack_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_installed_by_actor_id_actors_id_fk" FOREIGN KEY ("installed_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_run_deliveries" ADD CONSTRAINT "slack_run_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_run_deliveries" ADD CONSTRAINT "slack_run_deliveries_installation_id_slack_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."slack_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_run_deliveries" ADD CONSTRAINT "slack_run_deliveries_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_run_deliveries" ADD CONSTRAINT "slack_run_deliveries_inbox_event_id_slack_inbox_events_id_fk" FOREIGN KEY ("inbox_event_id") REFERENCES "public"."slack_inbox_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_exposures_installation_agent_unique" ON "slack_agent_exposures" USING btree ("installation_id","agent_id");--> statement-breakpoint
CREATE INDEX "slack_exposures_org_enabled_idx" ON "slack_agent_exposures" USING btree ("organisation_id","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_identity_installation_user_unique" ON "slack_identity_mappings" USING btree ("installation_id","slack_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_identity_org_actor_unique" ON "slack_identity_mappings" USING btree ("organisation_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_inbox_installation_event_unique" ON "slack_inbox_events" USING btree ("installation_id","event_id");--> statement-breakpoint
CREATE INDEX "slack_inbox_org_status_idx" ON "slack_inbox_events" USING btree ("organisation_id","status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_installations_team_unique" ON "slack_installations" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "slack_installations_org_status_idx" ON "slack_installations" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_delivery_installation_run_unique" ON "slack_run_deliveries" USING btree ("installation_id","run_id");--> statement-breakpoint
CREATE INDEX "slack_delivery_org_status_idx" ON "slack_run_deliveries" USING btree ("organisation_id","status","updated_at");