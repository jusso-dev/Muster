ALTER TABLE "tasks" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
UPDATE "tasks" SET "idempotency_key" = 'legacy:' || "id"::text WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_org_idempotency_unique" ON "tasks" USING btree ("organisation_id","idempotency_key");
