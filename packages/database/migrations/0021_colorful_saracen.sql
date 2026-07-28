CREATE TABLE "mcp_installations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bound_actor_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"installed_by_actor_id" uuid NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_installations" ADD CONSTRAINT "mcp_installations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_installations" ADD CONSTRAINT "mcp_installations_bound_actor_id_actors_id_fk" FOREIGN KEY ("bound_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_installations" ADD CONSTRAINT "mcp_installations_installed_by_actor_id_actors_id_fk" FOREIGN KEY ("installed_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_installations" ADD CONSTRAINT "mcp_installations_revoked_by_actor_id_actors_id_fk" FOREIGN KEY ("revoked_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_installations_token_hash_unique" ON "mcp_installations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mcp_installations_org_status_idx" ON "mcp_installations" USING btree ("organisation_id","status");