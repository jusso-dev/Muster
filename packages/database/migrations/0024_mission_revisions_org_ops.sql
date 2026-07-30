ALTER TABLE "governed_missions" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "governed_mission_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_summary" text DEFAULT '' NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governed_mission_revisions" ADD CONSTRAINT "governed_mission_revisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governed_mission_revisions" ADD CONSTRAINT "governed_mission_revisions_mission_id_governed_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."governed_missions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "governed_mission_revisions" ADD CONSTRAINT "governed_mission_revisions_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "governed_mission_revisions_mission_rev_unique" ON "governed_mission_revisions" USING btree ("mission_id","revision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "governed_mission_revisions_mission_idx" ON "governed_mission_revisions" USING btree ("organisation_id","mission_id","created_at");
