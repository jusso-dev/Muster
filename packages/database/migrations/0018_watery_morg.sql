CREATE TABLE "synthetic_cleanup_receipts" (
	"manifest_id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"maintenance_actor_id" uuid NOT NULL,
	"manifest_digest" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"candidate_counts" jsonb NOT NULL,
	"pre_digests" jsonb NOT NULL,
	"post_digests" jsonb NOT NULL,
	"object_storage_objects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trace_id" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "synthetic_cleanup_receipts" ADD CONSTRAINT "synthetic_cleanup_receipts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthetic_cleanup_receipts" ADD CONSTRAINT "synthetic_cleanup_receipts_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthetic_cleanup_receipts" ADD CONSTRAINT "synthetic_cleanup_receipts_maintenance_actor_id_actors_id_fk" FOREIGN KEY ("maintenance_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "synthetic_cleanup_receipts_approval_unique" ON "synthetic_cleanup_receipts" USING btree ("approval_id");--> statement-breakpoint
CREATE UNIQUE INDEX "synthetic_cleanup_receipts_org_digest_unique" ON "synthetic_cleanup_receipts" USING btree ("organisation_id","manifest_digest");--> statement-breakpoint
CREATE FUNCTION "prevent_append_only_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "synthetic_cleanup_receipts_append_only"
BEFORE UPDATE OR DELETE ON "synthetic_cleanup_receipts"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "message_revisions_append_only"
BEFORE UPDATE OR DELETE ON "message_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
