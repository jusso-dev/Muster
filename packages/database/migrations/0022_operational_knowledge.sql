CREATE TABLE "operational_knowledge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"classification" text DEFAULT 'internal' NOT NULL,
	"evidence_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_installation_id" uuid,
	"proposed_by_actor_id" uuid NOT NULL,
	"supersedes_id" uuid,
	"expires_at" timestamp with time zone,
	"reviewed_by_actor_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"policy_decision" text DEFAULT 'pending_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operational_knowledge" ADD CONSTRAINT "operational_knowledge_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_knowledge" ADD CONSTRAINT "operational_knowledge_source_installation_id_mcp_installations_id_fk" FOREIGN KEY ("source_installation_id") REFERENCES "public"."mcp_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_knowledge" ADD CONSTRAINT "operational_knowledge_proposed_by_actor_id_actors_id_fk" FOREIGN KEY ("proposed_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_knowledge" ADD CONSTRAINT "operational_knowledge_reviewed_by_actor_id_actors_id_fk" FOREIGN KEY ("reviewed_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_knowledge" ADD CONSTRAINT "operational_knowledge_proposer_org_fk" FOREIGN KEY ("proposed_by_actor_id","organisation_id") REFERENCES "public"."actors"("id","organisation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operational_knowledge_org_status_idx" ON "operational_knowledge" USING btree ("organisation_id","status","created_at");--> statement-breakpoint
CREATE INDEX "operational_knowledge_org_hash_idx" ON "operational_knowledge" USING btree ("organisation_id","content_hash");--> statement-breakpoint
ALTER TABLE "operational_knowledge" ADD CONSTRAINT "operational_knowledge_kind_check" CHECK ("kind" in ('fact','finding','correction','procedure'));--> statement-breakpoint
ALTER TABLE "operational_knowledge" ADD CONSTRAINT "operational_knowledge_status_check" CHECK ("status" in ('proposed','accepted','quarantined','rejected','superseded','expired'));--> statement-breakpoint
ALTER TABLE "operational_knowledge" ADD CONSTRAINT "operational_knowledge_policy_check" CHECK ("policy_decision" in ('accepted','quarantined','rejected','pending_review'));--> statement-breakpoint
ALTER TABLE "operational_knowledge" ADD CONSTRAINT "operational_knowledge_classification_check" CHECK ("classification" in ('public','internal','confidential','restricted'));
