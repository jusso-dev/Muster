CREATE TABLE "integration_connector_credentials" (
	"organisation_id" uuid NOT NULL,
	"integration_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_credential" text NOT NULL,
	"envelope_version" text DEFAULT 'v1' NOT NULL,
	"rotation_version" integer DEFAULT 1 NOT NULL,
	"rotated_by_actor_id" uuid NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_query_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"requested_by_actor_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"trace_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_query_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_connector_credentials" ADD CONSTRAINT "integration_connector_credentials_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connector_credentials" ADD CONSTRAINT "integration_connector_credentials_integration_id_integration_records_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connector_credentials" ADD CONSTRAINT "integration_connector_credentials_rotated_by_actor_id_actors_id_fk" FOREIGN KEY ("rotated_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_query_runs" ADD CONSTRAINT "integration_query_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_query_runs" ADD CONSTRAINT "integration_query_runs_integration_id_integration_records_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_query_runs" ADD CONSTRAINT "integration_query_runs_template_id_integration_query_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."integration_query_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_query_runs" ADD CONSTRAINT "integration_query_runs_requested_by_actor_id_actors_id_fk" FOREIGN KEY ("requested_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_query_templates" ADD CONSTRAINT "integration_query_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_query_templates" ADD CONSTRAINT "integration_query_templates_integration_id_integration_records_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_query_templates" ADD CONSTRAINT "integration_query_templates_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_credentials_org_idx" ON "integration_connector_credentials" USING btree ("organisation_id","integration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_query_runs_org_idempotency_unique" ON "integration_query_runs" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_query_runs_org_status_idx" ON "integration_query_runs" USING btree ("organisation_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_templates_org_key_version_unique" ON "integration_query_templates" USING btree ("organisation_id","integration_id","template_key","version");