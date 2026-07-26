CREATE TYPE "public"."actor_type" AS ENUM('human', 'agent', 'product', 'service', 'system');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('new', 'acknowledged', 'investigating', 'dismissed', 'promoted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'cancelled', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."investigation_status" AS ENUM('open', 'triaging', 'investigating', 'awaiting_approval', 'promoted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'system', 'alert', 'finding', 'decision', 'approval', 'workflow', 'agent-status', 'query-result', 'evidence', 'case-event', 'response-action');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('operations', 'incident', 'investigation', 'hunt', 'engineering', 'private', 'direct', 'system');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('critical', 'high', 'medium', 'low', 'informational');--> statement-breakpoint
CREATE TABLE "actors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"display_name" text NOT NULL,
	"avatar" text,
	"icon" text,
	"status" text DEFAULT 'active' NOT NULL,
	"identity_reference" text,
	"capability_assignments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"avatar" text,
	"runtime" text NOT NULL,
	"model" text NOT NULL,
	"owner_actor_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"system_prompt_version" text NOT NULL,
	"allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_rooms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capability_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"maximum_runtime_seconds" integer DEFAULT 300 NOT NULL,
	"maximum_token_budget" integer DEFAULT 20000 NOT NULL,
	"maximum_cost_cents" integer DEFAULT 500 NOT NULL,
	"data_classification_allowance" jsonb DEFAULT '["internal"]'::jsonb NOT NULL,
	"approval_requirements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"source_run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"evidence_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" integer NOT NULL,
	"classification" text DEFAULT 'internal' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"supersedes_memory_id" uuid,
	"expires_at" timestamp with time zone,
	"reviewed_by_actor_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_memories_kind_check" CHECK ("agent_memories"."kind" in ('fact','preference','lesson','failure','procedure_hint')),
	CONSTRAINT "agent_memories_status_check" CHECK ("agent_memories"."status" in ('active','superseded','expired','rejected')),
	CONSTRAINT "agent_memories_confidence_check" CHECK ("agent_memories"."confidence" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"room_id" uuid,
	"investigation_id" uuid,
	"workflow_run_id" uuid,
	"requested_by_actor_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"input_hash" text NOT NULL,
	"output_hash" text,
	"prompt_version" text NOT NULL,
	"runtime" text NOT NULL,
	"model" text NOT NULL,
	"token_usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimated_cost_cents" integer DEFAULT 0 NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"cancellation_reason" text,
	"structured_output" jsonb,
	"idempotency_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_skill_evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"skill_version_id" uuid NOT NULL,
	"evaluator_actor_id" uuid NOT NULL,
	"suite" text NOT NULL,
	"passed" boolean NOT NULL,
	"score" integer NOT NULL,
	"baseline_score" integer,
	"regressions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_skill_evaluations_score_check" CHECK ("agent_skill_evaluations"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "agent_skill_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"source_run_id" uuid NOT NULL,
	"based_on_version_id" uuid,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"change_rationale" text NOT NULL,
	"evidence_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"approved_by_actor_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_skill_versions_state_check" CHECK ("agent_skill_versions"."state" in ('proposed','evaluating','approved','rejected','published','rolled_back'))
);
--> statement-breakpoint
CREATE TABLE "agent_skills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"skill_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"active_version_id" uuid,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_skills_status_check" CHECK ("agent_skills"."status" in ('draft','evaluating','published','retired'))
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"source_product" text NOT NULL,
	"source_instance" text NOT NULL,
	"external_reference" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"severity" "severity" NOT NULL,
	"status" "alert_status" DEFAULT 'new' NOT NULL,
	"rule_name" text,
	"rule_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_actor_id" uuid,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_reference_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"investigation_id" uuid,
	"kelpie_case_id" text,
	"room_id" uuid,
	"dedupe_key" text NOT NULL,
	"correlation_key" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"requesting_actor_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"target" jsonb NOT NULL,
	"risk_summary" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"required_capability" text NOT NULL,
	"required_approval_count" integer DEFAULT 1 NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision_at" timestamp with time zone,
	"reason" text,
	"idempotency_key" text NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"previous_hash" text NOT NULL,
	"event_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"trace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"aaguid" text,
	CONSTRAINT "auth_passkey_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"rationale" text NOT NULL,
	"decision_maker_actor_id" uuid NOT NULL,
	"alternatives_considered" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_investigation_id" uuid,
	"related_case_id" text,
	"related_workflow_run_id" uuid,
	"approval_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by_actor_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"classification" text NOT NULL,
	"related_room_id" uuid,
	"related_investigation_id" uuid,
	"related_case_id" text,
	"source" text NOT NULL,
	"original_timestamp" timestamp with time zone,
	"storage_key" text NOT NULL,
	"scan_state" text DEFAULT 'pending' NOT NULL,
	"retention_state" text DEFAULT 'active' NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"object_lock_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"investigation_id" uuid NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"confidence" integer NOT NULL,
	"severity" "severity" NOT NULL,
	"supporting_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_observables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_action" text,
	"agent_provenance" jsonb,
	"human_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hypotheses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"investigation_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"confidence" integer DEFAULT 50 NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"supporting_finding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contradicting_finding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"organisation_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_records_organisation_id_scope_key_pk" PRIMARY KEY("organisation_id","scope","key")
);
--> statement-breakpoint
CREATE TABLE "integration_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_entities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"posture" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integration_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"product" text NOT NULL,
	"instance_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"mock" boolean DEFAULT false NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"investigation_number" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" "investigation_status" DEFAULT 'open' NOT NULL,
	"severity" "severity" NOT NULL,
	"lead_actor_id" uuid,
	"room_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"recommendation" text,
	"disposition" text,
	"promotion_decision" jsonb,
	"linked_kelpie_case_id" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"thread_parent_id" uuid,
	"author_actor_id" uuid NOT NULL,
	"message_type" "message_type" NOT NULL,
	"document" jsonb NOT NULL,
	"plain_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"data_classification" text DEFAULT 'internal' NOT NULL,
	"related_alert_id" uuid,
	"related_investigation_id" uuid,
	"related_case_id" text,
	"related_agent_run_id" uuid,
	"related_workflow_run_id" uuid,
	"idempotency_key" text
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"safe_preview" text,
	"target" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"data_region" text DEFAULT 'australia' NOT NULL,
	"default_timezone" text DEFAULT 'Australia/Sydney' NOT NULL,
	"retention_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"authentication_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_status_check" CHECK ("organisations"."status" in ('active','suspended'))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"queue_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"trace_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"organisation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_message_id_actor_id_emoji_pk" PRIMARY KEY("message_id","actor_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "room_memberships" (
	"organisation_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"membership_role" text NOT NULL,
	"notification_level" text DEFAULT 'all' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_event_id" uuid,
	"muted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "room_memberships_room_id_actor_id_pk" PRIMARY KEY("room_id","actor_id"),
	CONSTRAINT "room_membership_role_check" CHECK ("room_memberships"."membership_role" in ('owner','moderator','member','guest','agent_member'))
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"room_type" "room_type" NOT NULL,
	"visibility" text DEFAULT 'organisation' NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"linked_investigation_id" uuid,
	"linked_kelpie_case_id" text,
	"default_severity" "severity",
	"tlp" text DEFAULT 'amber' NOT NULL,
	"retention_policy" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"investigation_id" uuid,
	"room_id" uuid,
	"external_case_id" text,
	"actor_id" uuid,
	"event_type" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"better_auth_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"avatar" text,
	"job_title" text,
	"team" text,
	"presence_state" text DEFAULT 'offline' NOT NULL,
	"timezone" text DEFAULT 'Australia/Sydney' NOT NULL,
	"notification_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"workflow_key" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"yaml" text NOT NULL,
	"parsed" jsonb NOT NULL,
	"owner_actor_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"workflow_definition_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger_event_id" text,
	"room_id" uuid,
	"investigation_id" uuid,
	"requested_by_actor_id" uuid,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"idempotency_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_owner_actor_id_actors_id_fk" FOREIGN KEY ("owner_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_agent_id_agent_definitions_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_reviewed_by_actor_id_actors_id_fk" FOREIGN KEY ("reviewed_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agent_definitions_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_requested_by_actor_id_actors_id_fk" FOREIGN KEY ("requested_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_evaluations" ADD CONSTRAINT "agent_skill_evaluations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_evaluations" ADD CONSTRAINT "agent_skill_evaluations_skill_version_id_agent_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."agent_skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_evaluations" ADD CONSTRAINT "agent_skill_evaluations_evaluator_actor_id_actors_id_fk" FOREIGN KEY ("evaluator_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_versions" ADD CONSTRAINT "agent_skill_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_versions" ADD CONSTRAINT "agent_skill_versions_skill_id_agent_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."agent_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_versions" ADD CONSTRAINT "agent_skill_versions_source_run_id_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skill_versions" ADD CONSTRAINT "agent_skill_versions_approved_by_actor_id_actors_id_fk" FOREIGN KEY ("approved_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agent_id_agent_definitions_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_assigned_actor_id_actors_id_fk" FOREIGN KEY ("assigned_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requesting_actor_id_actors_id_fk" FOREIGN KEY ("requesting_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_passkey" ADD CONSTRAINT "auth_passkey_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_two_factor" ADD CONSTRAINT "auth_two_factor_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decision_maker_actor_id_actors_id_fk" FOREIGN KEY ("decision_maker_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_related_investigation_id_investigations_id_fk" FOREIGN KEY ("related_investigation_id") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_actor_id_actors_id_fk" FOREIGN KEY ("uploaded_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_related_room_id_rooms_id_fk" FOREIGN KEY ("related_room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_related_investigation_id_investigations_id_fk" FOREIGN KEY ("related_investigation_id") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_integration_id_integration_records_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_entities" ADD CONSTRAINT "integration_entities_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_entities" ADD CONSTRAINT "integration_entities_integration_id_integration_records_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_records" ADD CONSTRAINT "integration_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_lead_actor_id_actors_id_fk" FOREIGN KEY ("lead_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_actor_id_actors_id_fk" FOREIGN KEY ("author_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_related_alert_id_alerts_id_fk" FOREIGN KEY ("related_alert_id") REFERENCES "public"."alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_related_investigation_id_investigations_id_fk" FOREIGN KEY ("related_investigation_id") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_memberships" ADD CONSTRAINT "room_memberships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_memberships" ADD CONSTRAINT "room_memberships_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_memberships" ADD CONSTRAINT "room_memberships_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_created_by_actor_id_actors_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_better_auth_user_id_auth_user_id_fk" FOREIGN KEY ("better_auth_user_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_owner_actor_id_actors_id_fk" FOREIGN KEY ("owner_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_requested_by_actor_id_actors_id_fk" FOREIGN KEY ("requested_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actors_org_type_idx" ON "actors" USING btree ("organisation_id","actor_type");--> statement-breakpoint
CREATE UNIQUE INDEX "actors_org_identity_unique" ON "actors" USING btree ("organisation_id","identity_reference") WHERE "actors"."identity_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_definitions_org_name_unique" ON "agent_definitions" USING btree ("organisation_id","name");--> statement-breakpoint
CREATE INDEX "agent_memories_org_agent_idx" ON "agent_memories" USING btree ("organisation_id","agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_org_idempotency_unique" ON "agent_runs" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_runs_org_status_idx" ON "agent_runs" USING btree ("organisation_id","status","started_at");--> statement-breakpoint
CREATE INDEX "agent_skill_evaluations_version_idx" ON "agent_skill_evaluations" USING btree ("organisation_id","skill_version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_skill_versions_skill_version_unique" ON "agent_skill_versions" USING btree ("skill_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_skill_versions_content_hash_unique" ON "agent_skill_versions" USING btree ("organisation_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_skills_org_agent_key_unique" ON "agent_skills" USING btree ("organisation_id","agent_id","skill_key");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_org_source_ref_unique" ON "alerts" USING btree ("organisation_id","source_product","source_instance","external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_org_dedupe_unique" ON "alerts" USING btree ("organisation_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "alerts_org_queue_idx" ON "alerts" USING btree ("organisation_id","status","severity","received_at");--> statement-breakpoint
CREATE INDEX "alerts_search_idx" ON "alerts" USING gin (to_tsvector('english', "title" || ' ' || "description"));--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_org_idempotency_unique" ON "approvals" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "approvals_org_status_idx" ON "approvals" USING btree ("organisation_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_org_sequence_unique" ON "audit_events" USING btree ("organisation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_org_hash_unique" ON "audit_events" USING btree ("organisation_id","event_hash");--> statement-breakpoint
CREATE INDEX "audit_org_target_idx" ON "audit_events" USING btree ("organisation_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_unique" ON "auth_account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_passkey_user_idx" ON "auth_passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_two_factor_user_unique" ON "auth_two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "decisions_org_investigation_idx" ON "decisions" USING btree ("organisation_id","related_investigation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_org_hash_unique" ON "evidence" USING btree ("organisation_id","sha256");--> statement-breakpoint
CREATE INDEX "evidence_search_idx" ON "evidence" USING gin (to_tsvector('english', "file_name" || ' ' || "source"));--> statement-breakpoint
CREATE INDEX "findings_org_investigation_idx" ON "findings" USING btree ("organisation_id","investigation_id","created_at");--> statement-breakpoint
CREATE INDEX "findings_search_idx" ON "findings" USING gin (to_tsvector('english', "title" || ' ' || "summary"));--> statement-breakpoint
CREATE INDEX "hypotheses_org_investigation_idx" ON "hypotheses" USING btree ("organisation_id","investigation_id");--> statement-breakpoint
CREATE INDEX "idempotency_expiry_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_delivery_org_idempotency_unique" ON "integration_deliveries" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_entities_org_external_unique" ON "integration_entities" USING btree ("organisation_id","integration_id","entity_type","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_product_instance_unique" ON "integration_records" USING btree ("organisation_id","product","instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investigations_org_number_unique" ON "investigations" USING btree ("organisation_id","investigation_number");--> statement-breakpoint
CREATE INDEX "investigations_org_queue_idx" ON "investigations" USING btree ("organisation_id","status","severity","last_activity_at");--> statement-breakpoint
CREATE INDEX "investigations_search_idx" ON "investigations" USING gin (to_tsvector('english', "title" || ' ' || "summary"));--> statement-breakpoint
CREATE INDEX "messages_org_room_time_idx" ON "messages" USING btree ("organisation_id","room_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_parent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_org_idempotency_unique" ON "messages" USING btree ("organisation_id","idempotency_key") WHERE "messages"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "messages_search_idx" ON "messages" USING gin (to_tsvector('english', "plain_text"));--> statement-breakpoint
CREATE INDEX "notifications_org_actor_read_idx" ON "notifications" USING btree ("organisation_id","actor_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_slug_unique" ON "organisations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_idempotency_unique" ON "outbox_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("available_at","created_at") WHERE "outbox_events"."dispatched_at" is null;--> statement-breakpoint
CREATE INDEX "room_memberships_org_actor_idx" ON "room_memberships" USING btree ("organisation_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_org_slug_unique" ON "rooms" USING btree ("organisation_id","slug");--> statement-breakpoint
CREATE INDEX "rooms_org_type_idx" ON "rooms" USING btree ("organisation_id","room_type");--> statement-breakpoint
CREATE INDEX "timeline_org_investigation_time_idx" ON "timeline_events" USING btree ("organisation_id","investigation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_email_unique" ON "users" USING btree ("organisation_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_better_auth_unique" ON "users" USING btree ("better_auth_user_id");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_defs_org_key_version_unique" ON "workflow_definitions" USING btree ("organisation_id","workflow_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_org_idempotency_unique" ON "workflow_runs" USING btree ("organisation_id","idempotency_key");