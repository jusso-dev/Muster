CREATE TABLE "synthetic_artifact_provenance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"artifact_table" text NOT NULL,
	"artifact_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_reference" text NOT NULL,
	"recorded_by_actor_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "synthetic_artifact_provenance_table_check" CHECK ("synthetic_artifact_provenance"."artifact_table" in ('rooms','tasks','hunts','integrations','researchWatchlists','reportManifests','reportSchedules','messages','evidence','agentMemories','actors')),
	CONSTRAINT "synthetic_artifact_provenance_source_check" CHECK ("synthetic_artifact_provenance"."source_kind" in ('seed_fixture','mock_runtime','test_fixture','legacy_live_proof'))
);
--> statement-breakpoint
CREATE TABLE "synthetic_cleanup_object_deletion_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"manifest_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"version_id" text NOT NULL,
	"authorization_approval_id" uuid NOT NULL,
	"result" text NOT NULL,
	"error_code" text,
	"attempted_by_actor_id" uuid NOT NULL,
	"trace_id" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "synthetic_cleanup_object_attempts_result_check" CHECK ("synthetic_cleanup_object_deletion_attempts"."result" in ('started','succeeded','failed','observed_missing'))
);
--> statement-breakpoint
ALTER TABLE "synthetic_artifact_provenance" ADD CONSTRAINT "synthetic_artifact_provenance_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthetic_artifact_provenance" ADD CONSTRAINT "synthetic_artifact_provenance_recorded_by_actor_id_actors_id_fk" FOREIGN KEY ("recorded_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthetic_cleanup_object_deletion_attempts" ADD CONSTRAINT "synthetic_cleanup_object_deletion_attempts_manifest_id_synthetic_cleanup_receipts_manifest_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."synthetic_cleanup_receipts"("manifest_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthetic_cleanup_object_deletion_attempts" ADD CONSTRAINT "synthetic_cleanup_object_deletion_attempts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthetic_cleanup_object_deletion_attempts" ADD CONSTRAINT "synthetic_cleanup_object_deletion_attempts_authorization_approval_id_approvals_id_fk" FOREIGN KEY ("authorization_approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthetic_cleanup_object_deletion_attempts" ADD CONSTRAINT "synthetic_cleanup_object_deletion_attempts_attempted_by_actor_id_actors_id_fk" FOREIGN KEY ("attempted_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "synthetic_artifact_provenance_artifact_unique" ON "synthetic_artifact_provenance" USING btree ("organisation_id","artifact_table","artifact_id");--> statement-breakpoint
CREATE INDEX "synthetic_cleanup_object_attempts_manifest_idx" ON "synthetic_cleanup_object_deletion_attempts" USING btree ("organisation_id","manifest_id","attempted_at");--> statement-breakpoint
CREATE TRIGGER "synthetic_artifact_provenance_append_only"
BEFORE UPDATE OR DELETE ON "synthetic_artifact_provenance"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "synthetic_cleanup_object_attempts_append_only"
BEFORE UPDATE OR DELETE ON "synthetic_cleanup_object_deletion_attempts"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
