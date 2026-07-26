CREATE TABLE "room_integration_bindings" (
	"organisation_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_integration_bindings_room_id_integration_id_pk" PRIMARY KEY("room_id","integration_id")
);
--> statement-breakpoint
CREATE TABLE "room_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"invited_actor_id" uuid NOT NULL,
	"membership_role" text NOT NULL,
	"access_expires_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"invited_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "room_invitation_role_check" CHECK ("room_invitations"."membership_role" in ('moderator','member','guest','agent_member')),
	CONSTRAINT "room_invitation_status_check" CHECK ("room_invitations"."status" in ('pending','accepted','revoked','expired'))
);
--> statement-breakpoint
ALTER TABLE "room_memberships" ADD COLUMN "favourite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "room_memberships" ADD COLUMN "sidebar_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "room_memberships" ADD COLUMN "sidebar_group" text;--> statement-breakpoint
ALTER TABLE "room_memberships" ADD COLUMN "access_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "policies" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "direct_fingerprint" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "room_integration_bindings" ADD CONSTRAINT "room_integration_bindings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_integration_bindings" ADD CONSTRAINT "room_integration_bindings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_integration_bindings" ADD CONSTRAINT "room_integration_bindings_integration_id_integration_records_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_integration_bindings" ADD CONSTRAINT "room_integration_bindings_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_invitations" ADD CONSTRAINT "room_invitations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_invitations" ADD CONSTRAINT "room_invitations_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_invitations" ADD CONSTRAINT "room_invitations_invited_actor_id_actors_id_fk" FOREIGN KEY ("invited_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_invitations" ADD CONSTRAINT "room_invitations_invited_by_actor_id_actors_id_fk" FOREIGN KEY ("invited_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_integration_bindings_org_room_idx" ON "room_integration_bindings" USING btree ("organisation_id","room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_invitations_org_idempotency_unique" ON "room_invitations" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "room_invitations_org_room_status_idx" ON "room_invitations" USING btree ("organisation_id","room_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_org_direct_fingerprint_unique" ON "rooms" USING btree ("organisation_id","direct_fingerprint") WHERE "rooms"."direct_fingerprint" is not null;