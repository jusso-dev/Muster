CREATE TABLE "message_mentions" (
	"organisation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"mentioned_actor_id" uuid,
	"mention_type" text NOT NULL,
	"mention_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_mentions_message_id_mention_type_mention_key_pk" PRIMARY KEY("message_id","mention_type","mention_key"),
	CONSTRAINT "message_mention_type_check" CHECK ("message_mentions"."mention_type" in ('actor','room','everyone'))
);
--> statement-breakpoint
CREATE TABLE "message_pins" (
	"organisation_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"pinned_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_pins_room_id_message_id_pk" PRIMARY KEY("room_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "message_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"revision_type" text NOT NULL,
	"previous_document" jsonb NOT NULL,
	"previous_plain_text" text NOT NULL,
	"next_document" jsonb,
	"next_plain_text" text,
	"reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_revision_type_check" CHECK ("message_revisions"."revision_type" in ('edit','delete'))
);
--> statement-breakpoint
CREATE TABLE "message_saves" (
	"organisation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_saves_message_id_actor_id_pk" PRIMARY KEY("message_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "reaction_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"active" boolean NOT NULL,
	"result_count" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_follows" (
	"organisation_id" uuid NOT NULL,
	"root_message_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_follows_root_message_id_actor_id_pk" PRIMARY KEY("root_message_id","actor_id")
);
--> statement-breakpoint
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_mentioned_actor_id_actors_id_fk" FOREIGN KEY ("mentioned_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_pins" ADD CONSTRAINT "message_pins_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_pins" ADD CONSTRAINT "message_pins_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_pins" ADD CONSTRAINT "message_pins_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_pins" ADD CONSTRAINT "message_pins_pinned_by_actor_id_actors_id_fk" FOREIGN KEY ("pinned_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_revisions" ADD CONSTRAINT "message_revisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_revisions" ADD CONSTRAINT "message_revisions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_revisions" ADD CONSTRAINT "message_revisions_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_saves" ADD CONSTRAINT "message_saves_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_saves" ADD CONSTRAINT "message_saves_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_saves" ADD CONSTRAINT "message_saves_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_operations" ADD CONSTRAINT "reaction_operations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_operations" ADD CONSTRAINT "reaction_operations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction_operations" ADD CONSTRAINT "reaction_operations_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_follows" ADD CONSTRAINT "thread_follows_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_follows" ADD CONSTRAINT "thread_follows_root_message_id_messages_id_fk" FOREIGN KEY ("root_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_follows" ADD CONSTRAINT "thread_follows_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_mentions_org_actor_idx" ON "message_mentions" USING btree ("organisation_id","mentioned_actor_id","created_at");--> statement-breakpoint
CREATE INDEX "message_pins_org_room_idx" ON "message_pins" USING btree ("organisation_id","room_id","created_at");--> statement-breakpoint
CREATE INDEX "message_revisions_org_message_idx" ON "message_revisions" USING btree ("organisation_id","message_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_revisions_org_idempotency_unique" ON "message_revisions" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "message_saves_org_actor_idx" ON "message_saves" USING btree ("organisation_id","actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_operations_org_idempotency_unique" ON "reaction_operations" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "reaction_operations_org_message_idx" ON "reaction_operations" USING btree ("organisation_id","message_id");--> statement-breakpoint
CREATE INDEX "thread_follows_org_actor_idx" ON "thread_follows" USING btree ("organisation_id","actor_id");--> statement-breakpoint
UPDATE "actors"
SET "capability_assignments" = "capability_assignments" || '["messages.moderate"]'::jsonb
WHERE (
	"capability_assignments" ? 'administration.manage'
	OR "capability_assignments" ? 'rooms.manage'
)
AND NOT ("capability_assignments" ? 'messages.moderate');
