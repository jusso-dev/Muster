import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import { z } from "zod";
import { McpToolError } from "./errors.ts";
import { requireScope, type InstallationContext } from "./installation.ts";
import type { ToolResult } from "./tools.ts";

type Database = ReturnType<typeof database>;

const MAX_EXPORT = 100;

function redactMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return {};
  const src = metadata as Record<string, unknown>;
  // Never return raw arguments, prompts, or reasoning — only stable
  // attribution + hashes already stored by recordInvocation / actions.
  const allowed = [
    "tool",
    "toolVersion",
    "installationId",
    "outcome",
    "resultHash",
    "evidenceRefs",
    "errorCode",
    "operation",
    "capability",
    "approvalId",
    "via",
    "kind",
    "status",
    "policyDecision",
    "contentHash",
    "notAuthorisationProof",
    "policyReasons",
    "idempotencyKey",
  ] as const;
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in src) out[key] = src[key];
  }
  return out;
}

/**
 * Bounded list of recent MCP tool invocations for this organisation.
 * Uses audit_events (mcp.tool.invoked). No private reasoning.
 */
export async function listInvocations(
  db: Database,
  context: InstallationContext,
  args: { limit: number; tool?: string | undefined },
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_list_invocations");
  requireCapability(context.subject, "audit.read");

  const limit = Math.min(Math.max(args.limit, 1), 50);
  const conditions = [
    eq(schema.auditEvents.organisationId, context.subject.organisationId),
    eq(schema.auditEvents.action, "mcp.tool.invoked"),
  ];
  if (args.tool) {
    conditions.push(
      sql`${schema.auditEvents.metadata}->>'tool' = ${args.tool}`,
    );
  }

  const rows = await db
    .select({
      id: schema.auditEvents.id,
      sequence: schema.auditEvents.sequence,
      actorId: schema.auditEvents.actorId,
      actorType: schema.auditEvents.actorType,
      targetId: schema.auditEvents.targetId,
      metadata: schema.auditEvents.metadata,
      traceId: schema.auditEvents.traceId,
      createdAt: schema.auditEvents.createdAt,
      eventHash: schema.auditEvents.eventHash,
    })
    .from(schema.auditEvents)
    .where(and(...conditions))
    .orderBy(desc(schema.auditEvents.sequence))
    .limit(limit);

  return {
    payload: {
      records: rows.map((row) => ({
        id: row.id,
        sequence: row.sequence,
        actorId: row.actorId,
        actorType: row.actorType,
        tool: row.targetId,
        metadata: redactMetadata(row.metadata),
        traceId: row.traceId,
        createdAt: row.createdAt,
        eventHash: row.eventHash,
      })),
      limit,
      includesPrivateReasoning: false,
      replayMode: "recorded_results_only",
    },
    evidenceRefs: rows.map((r) => r.id),
  };
}

export const AuditExportSchema = z.object({
  limit: z.number().int().min(1).max(MAX_EXPORT).default(25),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  actions: z
    .array(
      z.enum([
        "mcp.tool.invoked",
        "integration.action.approval_requested",
        "integration.action.queued",
        "connector.query.queued",
        "knowledge.proposed",
      ]),
    )
    .max(10)
    .optional(),
});

/**
 * Bounded audit export for evaluation. Replay consumers must use recorded
 * hashes/results and must not re-issue external actions.
 */
export async function exportAudit(
  db: Database,
  context: InstallationContext,
  raw: unknown,
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_export_audit");
  requireCapability(context.subject, "audit.export");

  let args: z.infer<typeof AuditExportSchema>;
  try {
    args = AuditExportSchema.parse(raw ?? {});
  } catch (error) {
    throw new McpToolError(
      "invalid_input",
      error instanceof Error ? error.message : "Invalid audit export request.",
    );
  }

  const actions = args.actions ?? [
    "mcp.tool.invoked",
    "integration.action.approval_requested",
    "knowledge.proposed",
  ];
  const conditions = [
    eq(schema.auditEvents.organisationId, context.subject.organisationId),
    inArray(schema.auditEvents.action, actions),
  ];
  if (args.since)
    conditions.push(gte(schema.auditEvents.createdAt, new Date(args.since)));
  if (args.until)
    conditions.push(lte(schema.auditEvents.createdAt, new Date(args.until)));

  const rows = await db
    .select({
      id: schema.auditEvents.id,
      sequence: schema.auditEvents.sequence,
      actorId: schema.auditEvents.actorId,
      actorType: schema.auditEvents.actorType,
      action: schema.auditEvents.action,
      targetType: schema.auditEvents.targetType,
      targetId: schema.auditEvents.targetId,
      metadata: schema.auditEvents.metadata,
      traceId: schema.auditEvents.traceId,
      createdAt: schema.auditEvents.createdAt,
      eventHash: schema.auditEvents.eventHash,
      previousHash: schema.auditEvents.previousHash,
    })
    .from(schema.auditEvents)
    .where(and(...conditions))
    .orderBy(desc(schema.auditEvents.sequence))
    .limit(args.limit);

  return {
    payload: {
      records: rows.map((row) => ({
        id: row.id,
        sequence: row.sequence,
        actorId: row.actorId,
        actorType: row.actorType,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: redactMetadata(row.metadata),
        traceId: row.traceId,
        createdAt: row.createdAt,
        eventHash: row.eventHash,
        previousHash: row.previousHash,
      })),
      limit: args.limit,
      truncated: rows.length === args.limit,
      includesPrivateReasoning: false,
      includesChainOfThought: false,
      replay: {
        mode: "recorded_results_only",
        mayRepeatExternalActions: false,
      },
      evaluationHints: [
        "tenant_isolation",
        "schema_compliance",
        "approval_behavior",
        "evidence_citation",
        "injection_resistance",
        "unsupported_claims",
      ],
    },
    evidenceRefs: rows.map((r) => r.id),
  };
}
