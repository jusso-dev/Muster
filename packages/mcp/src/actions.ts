import { and, desc, eq, isNull } from "drizzle-orm";
import {
  actionApprovalPolicy,
  requireCapability,
  type ApprovalAction,
  type Capability,
} from "@muster/authz";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
} from "@muster/database";
import {
  encryptConnectorPayload,
  IntegrationActionRequestSchema,
  type IntegrationActionRequest,
} from "@muster/integrations";
import { z } from "zod";
import { McpToolError } from "./errors.ts";
import { requireScope, type InstallationContext } from "./installation.ts";
import type { ToolResult } from "./tools.ts";

type Database = ReturnType<typeof database>;

const KelpieWriteOperationSchema = z.enum([
  "kelpie.case.create",
  "kelpie.case.update",
  "kelpie.timeline.comment",
  "kelpie.observable.add",
]);

/**
 * MCP-facing proposal body: Hermes never supplies organisationId, actorId,
 * capability, or integrationId. The server binds those from the installation
 * credential and the organisation's enabled Kelpie connector.
 */
export const McpKelpieActionProposalSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("kelpie.case.create"),
    idempotencyKey: z.string().trim().min(8).max(200),
    title: z.string().trim().min(1).max(300),
    summary: z.string().trim().max(20_000).default(""),
    severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    tlp: z
      .enum(["clear", "green", "amber", "amber_strict", "red"])
      .default("amber"),
    pap: z.enum(["clear", "green", "amber", "red"]).default("amber"),
    classification: z
      .enum([
        "malware",
        "phishing",
        "unauthorised_access",
        "data_breach",
        "dos",
        "policy_violation",
        "other",
      ])
      .default("other"),
    tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    evidenceReferences: z
      .array(z.string().trim().min(1).max(500))
      .max(100)
      .default([]),
  }),
  z
    .object({
      operation: z.literal("kelpie.case.update"),
      idempotencyKey: z.string().trim().min(8).max(200),
      caseId: z.string().trim().min(1).max(200),
      version: z.number().int().positive().optional(),
      status: z
        .enum([
          "open",
          "in_progress",
          "contained",
          "eradicated",
          "recovered",
          "closed",
        ])
        .optional(),
      summary: z.string().trim().max(20_000).optional(),
    })
    .refine((value) => value.status || value.summary !== undefined, {
      message: "A Kelpie case update must change status or summary",
    }),
  z.object({
    operation: z.literal("kelpie.timeline.comment"),
    idempotencyKey: z.string().trim().min(8).max(200),
    caseId: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(20_000),
    evidenceReferences: z
      .array(z.string().trim().min(1).max(500))
      .max(100)
      .default([]),
  }),
  z.object({
    operation: z.literal("kelpie.observable.add"),
    idempotencyKey: z.string().trim().min(8).max(200),
    caseId: z.string().trim().min(1).max(200),
    observableType: z.enum([
      "ip",
      "domain",
      "url",
      "file_hash",
      "email",
      "hostname",
      "username",
      "registry_key",
      "other",
    ]),
    value: z.string().trim().min(1).max(4_000),
    tlp: z
      .enum(["clear", "green", "amber", "amber_strict", "red"])
      .default("amber"),
    description: z.string().trim().max(2_000).optional(),
    isIoc: z.boolean().default(true),
    tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  }),
]);

export type McpKelpieActionProposal = z.infer<
  typeof McpKelpieActionProposalSchema
>;

type ActionPolicy = {
  capability: Capability;
  approvalAction: ApprovalAction;
};

function actionPolicy(operation: z.infer<typeof KelpieWriteOperationSchema>): ActionPolicy {
  switch (operation) {
    case "kelpie.case.create":
      return {
        capability: "kelpie.cases.create",
        approvalAction: "investigation.promote",
      };
    case "kelpie.case.update":
    case "kelpie.timeline.comment":
    case "kelpie.observable.add":
      return {
        capability: "kelpie.cases.update",
        approvalAction: "kelpie.case.enrich",
      };
  }
}

function encryptionKey(): string {
  const key = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!key)
    throw new McpToolError(
      "not_configured",
      "Connector encryption is not configured.",
    );
  return key;
}

async function findKelpieIntegration(db: Database, organisationId: string) {
  const [integration] = await db
    .select({
      id: schema.integrationRecords.id,
      status: schema.integrationRecords.status,
    })
    .from(schema.integrationRecords)
    .where(
      and(
        eq(schema.integrationRecords.organisationId, organisationId),
        eq(schema.integrationRecords.product, "kelpie"),
        isNull(schema.integrationRecords.archivedAt),
      ),
    )
    .orderBy(desc(schema.integrationRecords.updatedAt))
    .limit(1);
  if (!integration || !["configured", "healthy"].includes(integration.status))
    throw new McpToolError(
      "not_configured",
      "Kelpie is not configured for this organisation.",
    );
  return integration;
}

function toIntegrationRequest(
  proposal: McpKelpieActionProposal,
  integrationId: string,
): IntegrationActionRequest {
  // Re-parse through the shared request schema so MCP proposals cannot
  // diverge from the worker/web action contract.
  const raw = {
    ...proposal,
    integrationId,
  };
  return IntegrationActionRequestSchema.parse(raw);
}

function riskSummary(operation: z.infer<typeof KelpieWriteOperationSchema>): string {
  switch (operation) {
    case "kelpie.case.create":
      return "Creates a formal external Kelpie case from proposed evidence (MCP).";
    case "kelpie.case.update":
      return "Updates an external Kelpie case status or summary (MCP).";
    case "kelpie.timeline.comment":
      return "Adds a timeline comment to an external Kelpie case (MCP).";
    case "kelpie.observable.add":
      return "Adds an observable to an external Kelpie case (MCP).";
  }
}

function publicAction(
  delivery: typeof schema.integrationDeliveries.$inferSelect,
  approval?: typeof schema.approvals.$inferSelect | null,
) {
  const request =
    delivery.requestMetadata &&
    typeof delivery.requestMetadata === "object" &&
    !Array.isArray(delivery.requestMetadata)
      ? (delivery.requestMetadata as Record<string, unknown>)
      : {};
  return {
    deliveryId: delivery.id,
    operation: delivery.operation,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    duplicate: false as boolean,
    approvalId:
      typeof request.approvalId === "string" ? request.approvalId : undefined,
    approval: approval
      ? {
          id: approval.id,
          status: approval.status,
          requiredCapability: approval.requiredCapability,
          requiredApprovalCount: approval.requiredApprovalCount,
          expiresAt: approval.expiresAt,
          decisionAt: approval.decisionAt,
          reason: approval.reason,
        }
      : undefined,
    responseMetadata: delivery.responseMetadata,
    error: delivery.error,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
}

/**
 * Proposes a Kelpie write through the same integration_deliveries +
 * approvals + outbox path the web IntegrationActionDomainService uses.
 * Always approval-gated for consequential ops. Client-supplied idempotency
 * keys resume the prior delivery on retry.
 */
export async function proposeKelpieAction(
  db: Database,
  context: InstallationContext,
  raw: unknown,
  traceId: string,
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_propose_kelpie_action");
  let proposal: McpKelpieActionProposal;
  try {
    proposal = McpKelpieActionProposalSchema.parse(raw);
  } catch (error) {
    throw new McpToolError(
      "invalid_input",
      error instanceof Error ? error.message : "Invalid Kelpie action proposal.",
    );
  }

  const policy = actionPolicy(proposal.operation);
  requireCapability(context.subject, policy.capability);

  const integration = await findKelpieIntegration(
    db,
    context.subject.organisationId,
  );

  // Authoritative re-check: capabilityAssignments on the bound actor may
  // have changed since the installation token was issued.
  const [actor] = await db
    .select({
      actorType: schema.actors.actorType,
      capabilities: schema.actors.capabilityAssignments,
    })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, context.subject.organisationId),
        eq(schema.actors.id, context.subject.actorId),
        eq(schema.actors.status, "active"),
      ),
    )
    .limit(1);
  if (
    !actor ||
    !Array.isArray(actor.capabilities) ||
    !actor.capabilities.includes(policy.capability)
  )
    throw new McpToolError(
      "forbidden",
      "Authoritative external-action capability is missing.",
    );

  let request: IntegrationActionRequest;
  try {
    request = toIntegrationRequest(proposal, integration.id);
  } catch (error) {
    throw new McpToolError(
      "invalid_input",
      error instanceof Error ? error.message : "Invalid action request.",
    );
  }

  const approvalPolicy = actionApprovalPolicy[policy.approvalAction];
  if (
    !("capability" in approvalPolicy) ||
    !approvalPolicy.capability ||
    !("approvalCount" in approvalPolicy)
  )
    throw new McpToolError(
      "not_configured",
      "External action lacks an executable approval policy.",
    );

  const result = await db.transaction(async (tx) => {
    const [duplicate] = await tx
      .select()
      .from(schema.integrationDeliveries)
      .where(
        and(
          eq(
            schema.integrationDeliveries.organisationId,
            context.subject.organisationId,
          ),
          eq(
            schema.integrationDeliveries.idempotencyKey,
            request.idempotencyKey,
          ),
        ),
      )
      .limit(1);
    if (duplicate) {
      const approvalId =
        duplicate.requestMetadata &&
        typeof duplicate.requestMetadata === "object" &&
        !Array.isArray(duplicate.requestMetadata) &&
        typeof (duplicate.requestMetadata as Record<string, unknown>)
          .approvalId === "string"
          ? ((duplicate.requestMetadata as Record<string, unknown>)
              .approvalId as string)
          : undefined;
      const [approval] = approvalId
        ? await tx
            .select()
            .from(schema.approvals)
            .where(
              and(
                eq(
                  schema.approvals.organisationId,
                  context.subject.organisationId,
                ),
                eq(schema.approvals.id, approvalId),
              ),
            )
            .limit(1)
        : [null];
      return {
        ...publicAction(duplicate, approval ?? null),
        duplicate: true,
      };
    }

    const id = newId();
    const approvalId = newId();
    const envelope = encryptConnectorPayload(request, encryptionKey());
    await tx.insert(schema.integrationDeliveries).values({
      id,
      organisationId: context.subject.organisationId,
      integrationId: integration.id,
      direction: "outbound",
      operation: request.operation,
      idempotencyKey: request.idempotencyKey,
      status: "awaiting_approval",
      requestMetadata: {
        actorId: context.subject.actorId,
        actorType: actor.actorType,
        traceId,
        operation: request.operation,
        envelope,
        approvalId,
        via: "mcp",
        installationId: context.installationId,
      },
    });
    await tx.insert(schema.approvals).values({
      id: approvalId,
      organisationId: context.subject.organisationId,
      requestingActorId: context.subject.actorId,
      actionType: policy.approvalAction,
      target: {
        deliveryId: id,
        integrationId: integration.id,
        operation: request.operation,
        via: "mcp",
        installationId: context.installationId,
      },
      riskSummary: riskSummary(proposal.operation),
      expiresAt: new Date(Date.now() + 30 * 60_000),
      requiredCapability: approvalPolicy.capability,
      requiredApprovalCount: approvalPolicy.approvalCount,
      idempotencyKey: `integration-approval:${request.idempotencyKey}`,
    });
    await appendAuditEvent(tx, {
      organisationId: context.subject.organisationId,
      actorId: context.subject.actorId,
      actorType: context.actorType,
      action: "integration.action.approval_requested",
      targetType: "integration_delivery",
      targetId: id,
      metadata: {
        integrationId: integration.id,
        operation: request.operation,
        capability: policy.capability,
        approvalId,
        via: "mcp",
        installationId: context.installationId,
      },
      traceId,
    });
    // No outbox until a human approves — worker only runs after approval
    // flips status to queued (same contract as web integration actions).
    return {
      deliveryId: id,
      operation: request.operation,
      status: "awaiting_approval" as const,
      attemptCount: 0,
      duplicate: false,
      approvalId,
      approval: {
        id: approvalId,
        status: "pending" as const,
        requiredCapability: approvalPolicy.capability,
        requiredApprovalCount: approvalPolicy.approvalCount,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        decisionAt: null,
        reason: null,
      },
      responseMetadata: {},
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  return {
    payload: {
      ...result,
      resumption: {
        tool: "muster_get_action_status",
        deliveryId: result.deliveryId,
      },
    },
    evidenceRefs: [result.deliveryId],
  };
}

/**
 * Resumes an earlier proposal by delivery id. Org-scoped; never returns
 * another organisation's action. Does not re-execute external work.
 */
export async function getActionStatus(
  db: Database,
  context: InstallationContext,
  args: { deliveryId: string },
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_get_action_status");

  const [delivery] = await db
    .select()
    .from(schema.integrationDeliveries)
    .where(
      and(
        eq(
          schema.integrationDeliveries.organisationId,
          context.subject.organisationId,
        ),
        eq(schema.integrationDeliveries.id, args.deliveryId),
      ),
    )
    .limit(1);
  if (!delivery)
    throw new McpToolError(
      "not_found",
      "Integration action does not exist for this organisation.",
    );

  const request =
    delivery.requestMetadata &&
    typeof delivery.requestMetadata === "object" &&
    !Array.isArray(delivery.requestMetadata)
      ? (delivery.requestMetadata as Record<string, unknown>)
      : {};
  const approvalId =
    typeof request.approvalId === "string" ? request.approvalId : undefined;
  const [approval] = approvalId
    ? await db
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.organisationId, context.subject.organisationId),
            eq(schema.approvals.id, approvalId),
          ),
        )
        .limit(1)
    : [null];

  return {
    payload: publicAction(delivery, approval ?? null),
    evidenceRefs: [delivery.id],
  };
}

