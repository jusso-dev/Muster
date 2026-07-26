CREATE TABLE "reaction_pack_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"name" text NOT NULL,
	"alt_text" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"frame_count" integer DEFAULT 1 NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"verification_state" text DEFAULT 'verified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reaction_pack_assets_verification_check" CHECK ("reaction_pack_assets"."verification_state" in ('verified','missing','mismatch')),
	CONSTRAINT "reaction_pack_assets_dimensions_check" CHECK ("reaction_pack_assets"."width" > 0 and "reaction_pack_assets"."height" > 0 and "reaction_pack_assets"."frame_count" > 0 and "reaction_pack_assets"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "reaction_pack_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approval_id" uuid,
	"approved_by_actor_id" uuid,
	"approved_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reaction_pack_revisions_status_check" CHECK ("reaction_pack_revisions"."status" in ('draft','approved','superseded','removed')),
	CONSTRAINT "reaction_pack_revisions_revision_check" CHECK ("reaction_pack_revisions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "reaction_packs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"removed_by_actor_id" uuid,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reaction_packs_lifecycle_check" CHECK ("reaction_packs"."lifecycle" in ('active','removed'))
);
--> statement-breakpoint
ALTER TABLE "reaction_pack_assets" ADD CONSTRAINT "reaction_pack_assets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_pack_assets" ADD CONSTRAINT "reaction_pack_assets_revision_id_reaction_pack_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."reaction_pack_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_pack_revisions" ADD CONSTRAINT "reaction_pack_revisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_pack_revisions" ADD CONSTRAINT "reaction_pack_revisions_pack_id_reaction_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."reaction_packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_pack_revisions" ADD CONSTRAINT "reaction_pack_revisions_approved_by_actor_id_actors_id_fk" FOREIGN KEY ("approved_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_pack_revisions" ADD CONSTRAINT "reaction_pack_revisions_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_packs" ADD CONSTRAINT "reaction_packs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_packs" ADD CONSTRAINT "reaction_packs_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_packs" ADD CONSTRAINT "reaction_packs_removed_by_actor_id_actors_id_fk" FOREIGN KEY ("removed_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_pack_assets_org_revision_name_unique" ON "reaction_pack_assets" USING btree ("organisation_id","revision_id","name");--> statement-breakpoint
CREATE INDEX "reaction_pack_assets_org_digest_idx" ON "reaction_pack_assets" USING btree ("organisation_id","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_pack_revisions_org_pack_revision_unique" ON "reaction_pack_revisions" USING btree ("organisation_id","pack_id","revision");--> statement-breakpoint
CREATE INDEX "reaction_pack_revisions_org_status_idx" ON "reaction_pack_revisions" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_packs_org_slug_unique" ON "reaction_packs" USING btree ("organisation_id","slug");--> statement-breakpoint
CREATE INDEX "reaction_packs_org_lifecycle_idx" ON "reaction_packs" USING btree ("organisation_id","lifecycle");