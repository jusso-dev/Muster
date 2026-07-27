CREATE TABLE "agent_runtime_checkpoint_writes" (
	"organisation_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"checkpoint_namespace" text DEFAULT '' NOT NULL,
	"checkpoint_id" text NOT NULL,
	"task_id" text NOT NULL,
	"write_index" integer NOT NULL,
	"run_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"type" text,
	"value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runtime_checkpoint_writes_organisation_id_thread_id_checkpoint_namespace_checkpoint_id_task_id_write_index_pk" PRIMARY KEY("organisation_id","thread_id","checkpoint_namespace","checkpoint_id","task_id","write_index")
);
--> statement-breakpoint
CREATE TABLE "agent_runtime_checkpoints" (
	"organisation_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"checkpoint_namespace" text DEFAULT '' NOT NULL,
	"checkpoint_id" text NOT NULL,
	"parent_checkpoint_id" text,
	"agent_id" uuid NOT NULL,
	"conversation_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"graph_version" text NOT NULL,
	"type" text,
	"checkpoint" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runtime_checkpoints_organisation_id_thread_id_checkpoint_namespace_checkpoint_id_pk" PRIMARY KEY("organisation_id","thread_id","checkpoint_namespace","checkpoint_id")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "graph_version" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "checkpoint_thread_id" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "pending_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD COLUMN "tool_call_id" text;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD COLUMN "checkpoint_id" text;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "agent_runtime_checkpoint_writes" ADD CONSTRAINT "agent_runtime_checkpoint_writes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_checkpoint_writes" ADD CONSTRAINT "agent_runtime_checkpoint_writes_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_checkpoints" ADD CONSTRAINT "agent_runtime_checkpoints_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_checkpoints" ADD CONSTRAINT "agent_runtime_checkpoints_agent_id_agent_definitions_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_checkpoints" ADD CONSTRAINT "agent_runtime_checkpoints_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runtime_checkpoint_writes_org_run_idx" ON "agent_runtime_checkpoint_writes" USING btree ("organisation_id","run_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runtime_checkpoints_org_run_idx" ON "agent_runtime_checkpoints" USING btree ("organisation_id","run_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runtime_checkpoints_org_thread_idx" ON "agent_runtime_checkpoints" USING btree ("organisation_id","thread_id","checkpoint_namespace","created_at");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_pending_approval_id_approvals_id_fk" FOREIGN KEY ("pending_approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_org_conversation_idx" ON "agent_runs" USING btree ("organisation_id","conversation_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tool_calls_org_idempotency_unique" ON "agent_tool_calls" USING btree ("organisation_id","idempotency_key");