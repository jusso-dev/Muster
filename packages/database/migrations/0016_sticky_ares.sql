CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"cadence" text NOT NULL,
	"timezone" text NOT NULL,
	"audience" text DEFAULT 'leadership' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedules_cadence_check" CHECK ("report_schedules"."cadence" in ('weekly','monthly')),
	CONSTRAINT "report_schedules_audience_check" CHECK ("report_schedules"."audience" in ('analyst','leadership','executive'))
);
--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_schedules_org_idempotency_unique" ON "report_schedules" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "report_schedules_org_due_idx" ON "report_schedules" USING btree ("organisation_id","enabled","next_run_at");