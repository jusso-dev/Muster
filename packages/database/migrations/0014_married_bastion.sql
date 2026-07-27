CREATE TABLE "research_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"research_run_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"source_url" text NOT NULL,
	"source_published_at" timestamp with time zone,
	"root_message_id" uuid,
	"latest_message_id" uuid,
	"brief" jsonb NOT NULL,
	"feedback" text,
	"feedback_by_actor_id" uuid,
	"feedback_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source_limit" integer NOT NULL,
	"token_budget" integer NOT NULL,
	"cost_limit_cents" integer NOT NULL,
	"time_limit_seconds" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"completed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_runs_status_check" CHECK ("research_runs"."status" in ('queued','running','completed','failed'))
);
--> statement-breakpoint
CREATE TABLE "research_watchlists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"vendors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"technologies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cadence_minutes" integer DEFAULT 240 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_watchlists_cadence_check" CHECK ("research_watchlists"."cadence_minutes" between 15 and 10080)
);
--> statement-breakpoint
ALTER TABLE "research_items" ADD CONSTRAINT "research_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_items" ADD CONSTRAINT "research_items_watchlist_id_research_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."research_watchlists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_items" ADD CONSTRAINT "research_items_research_run_id_research_runs_id_fk" FOREIGN KEY ("research_run_id") REFERENCES "public"."research_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_items" ADD CONSTRAINT "research_items_root_message_id_messages_id_fk" FOREIGN KEY ("root_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_items" ADD CONSTRAINT "research_items_latest_message_id_messages_id_fk" FOREIGN KEY ("latest_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_items" ADD CONSTRAINT "research_items_feedback_by_actor_id_actors_id_fk" FOREIGN KEY ("feedback_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_watchlist_id_research_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."research_watchlists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_watchlists" ADD CONSTRAINT "research_watchlists_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_watchlists" ADD CONSTRAINT "research_watchlists_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_watchlists" ADD CONSTRAINT "research_watchlists_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_items_org_fingerprint_unique" ON "research_items" USING btree ("organisation_id","fingerprint");--> statement-breakpoint
CREATE INDEX "research_items_org_watchlist_idx" ON "research_items" USING btree ("organisation_id","watchlist_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_runs_org_idempotency_unique" ON "research_runs" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "research_runs_org_agent_unique" ON "research_runs" USING btree ("organisation_id","agent_run_id");--> statement-breakpoint
CREATE INDEX "research_runs_org_status_idx" ON "research_runs" USING btree ("organisation_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_watchlists_org_name_unique" ON "research_watchlists" USING btree ("organisation_id","name");--> statement-breakpoint
CREATE INDEX "research_watchlists_due_idx" ON "research_watchlists" USING btree ("enabled","next_run_at");