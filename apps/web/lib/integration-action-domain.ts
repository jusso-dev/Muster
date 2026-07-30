import {
  actionApprovalPolicy,
  capabilities,
  requireCapability,
  type ApprovalAction,
  type AuthorisationSubject,
  type Capability,
} from "@muster/authz";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import {
  encryptConnectorPayload,
  IntegrationActionRequestSchema,
  type IntegrationActionRequest,
} from "@muster/integrations";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { ApiProblem } from "./api-context.ts";

const DecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(1).max(2_000),
});

type ActionPolicy = {
  product: "tawny_response" | "kelpie";
  capability: Capability;
  approvalAction?: ApprovalAction;
};

function actionPolicy(request: IntegrationActionRequest): ActionPolicy {
  switch (request.operation) {
    case "tawny.isolate_host":
      return {
        product: "tawny_response",
        capability: "tawny.response.isolate_host",
        approvalAction: "endpoint.isolate",
      };
    case "kelpie.case.create":
      return {
        product: "kelpie",
        capability: "kelpie.cases.create",
        approvalAction: "investigation.promote",
      };
    case "kelpie.case.update":
    case "kelpie.timeline.comment":
    case "kelpie.observable.add":
      return {
        product: "kelpie",
        capability: "kelpie.cases.update",
        approvalAction: "kelpie.case.enrich",
      };
  }
}

function encryptionKey() {
  const key = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!key)
    throw new ApiProblem(
      503,
      "Integration unavailable",
      "Connector encryption is not configured.",
    );
  return key;
}

function publicDelivery(
  delivery: typeof schema.integrationDeliveries.$inferSelect,
) {
  const request =
    delivery.requestMetadata &&
    typeof delivery.requestMetadata === "object" &&
    !Array.isArray(delivery.requestMetadata)
      ? (delivery.requestMetadata as Record<string, unknown>)
      : {};
  return {
    id: delivery.id,
    integrationId: delivery.integrationId,
    operation: request.operation,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    responseMetadata: delivery.responseMetadata,
    error: delivery.error,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
}

export class IntegrationActionDomainService {
  constructor(private readonly db = database()) {}

  async request(subject: AuthorisationSubject, raw: unknown, traceId: string) {
    const request = IntegrationActionRequestSchema.parse(raw);
    const policy = actionPolicy(request);
    requireCapability(subject, policy.capability);
    const [integration, actor] = await Promise.all([
      this.db
        .select({
          id: schema.integrationRecords.id,
          status: schema.integrationRecords.status,
          product: schema.integrationRecords.product,
        })
        .from(schema.integrationRecords)
        .where(
          and(
            eq(
              schema.integrationRecords.organisationId,
              subject.organisationId,
            ),
            eq(schema.integrationRecords.id, request.integrationId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      this.db
        .select({
          actorType: schema.actors.actorType,
          capabilities: schema.actors.capabilityAssignments,
        })
        .from(schema.actors)
        .where(
          and(
            eq(schema.actors.organisationId, subject.organisationId),
            eq(schema.actors.id, subject.actorId),
            eq(schema.actors.status, "active"),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
    ]);
    if (!integration || integration.product !== policy.product)
      throw new ApiProblem(
        404,
        "Integration not found",
        "The required organisation integration does not exist.",
      );
    if (!["configured", "healthy"].includes(integration.status))
      throw new ApiProblem(
        409,
        "Integration unavailable",
        "The integration is not enabled for external actions.",
      );
    if (
      !actor ||
      !Array.isArray(actor.capabilities) ||
      !actor.capabilities.includes(policy.capability)
    )
      throw new ApiProblem(
        403,
        "Forbidden",
        "Authoritative external-action capability is missing.",
      );
    if (request.roomId) {
      const [membership] = await this.db
        .select({ roomId: schema.roomMemberships.roomId })
        .from(schema.roomMemberships)
        .where(
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            eq(schema.roomMemberships.roomId, request.roomId),
            eq(schema.roomMemberships.actorId, subject.actorId),
          ),
        )
        .limit(1);
      if (!membership)
        throw new ApiProblem(
          403,
          "Forbidden",
          "Room membership is required for action evidence delivery.",
        );
    }
    if (request.taskId) {
      const [task] = await this.db
        .select({ roomId: schema.tasks.roomId })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.organisationId, subject.organisationId),
            eq(schema.tasks.id, request.taskId),
          ),
        )
        .limit(1);
      if (!task || (request.roomId && task.roomId !== request.roomId))
        throw new ApiProblem(
          404,
          "Task not found",
          "Task does not exist in the selected evidence room.",
        );
    }

    return this.db.transaction(async (tx) => {
      const [duplicate] = await tx
        .select()
        .from(schema.integrationDeliveries)
        .where(
          and(
            eq(
              schema.integrationDeliveries.organisationId,
              subject.organisationId,
            ),
            eq(
              schema.integrationDeliveries.idempotencyKey,
              request.idempotencyKey,
            ),
          ),
        )
        .limit(1);
      if (duplicate) return { ...publicDelivery(duplicate), duplicate: true };

      const id = newId();
      const approvalId = policy.approvalAction ? newId() : undefined;
      const envelope = encryptConnectorPayload(request, encryptionKey());
      await tx.insert(schema.integrationDeliveries).values({
        id,
        organisationId: subject.organisationId,
        integrationId: integration.id,
        direction: "outbound",
        operation: request.operation,
        idempotencyKey: request.idempotencyKey,
        status: approvalId ? "awaiting_approval" : "queued",
        requestMetadata: {
          actorId: subject.actorId,
          actorType: actor.actorType,
          traceId,
          operation: request.operation,
          envelope,
          ...(approvalId ? { approvalId } : {}),
          ...(request.roomId ? { roomId: request.roomId } : {}),
          ...(request.taskId ? { taskId: request.taskId } : {}),
        },
      });

      if (approvalId && policy.approvalAction) {
        const approvalPolicy = actionApprovalPolicy[policy.approvalAction];
        if (
          !("capability" in approvalPolicy) ||
          !approvalPolicy.capability ||
          !("approvalCount" in approvalPolicy)
        )
          throw new Error(
            "External action lacks an executable approval policy",
          );
        await tx.insert(schema.approvals).values({
          id: approvalId,
          organisationId: subject.organisationId,
          requestingActorId: subject.actorId,
          actionType: policy.approvalAction,
          target: {
            deliveryId: id,
            integrationId: integration.id,
            operation: request.operation,
          },
          riskSummary:
            request.operation === "tawny.isolate_host"
              ? "Isolates one Tawny endpoint from the network."
              : request.operation === "kelpie.case.create"
                ? "Creates a formal external Kelpie case from selected evidence."
                : "Adds approved enrichment to an external Kelpie case.",
          expiresAt: new Date(Date.now() + 30 * 60_000),
          requiredCapability: approvalPolicy.capability,
          requiredApprovalCount: approvalPolicy.approvalCount,
          idempotencyKey: `integration-approval:${request.idempotencyKey}`,
        });
      } else {
        await writeOutbox(tx, {
          organisationId: subject.organisationId,
          eventType: "integration.action.queued",
          aggregateType: "integration_delivery",
          aggregateId: id,
          queueName: "muster-integrations",
          payload: { deliveryId: id },
          idempotencyKey: `integration.action:${id}`,
          traceId,
        });
      }

      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: actor.actorType,
        action: approvalId
          ? "integration.action.approval_requested"
          : "integration.action.queued",
        targetType: "integration_delivery",
        targetId: id,
        metadata: {
          integrationId: integration.id,
          operation: request.operation,
          capability: policy.capability,
          approvalId,
        },
        traceId,
      });
      return {
        id,
        operation: request.operation,
        status: approvalId
          ? ("awaiting_approval" as const)
          : ("queued" as const),
        approvalId,
        duplicate: false,
      };
    });
  }

  async list(subject: AuthorisationSubject) {
    requireCapability(subject, "administration.manage");
    const rows = await this.db
      .select()
      .from(schema.integrationDeliveries)
      .where(
        eq(schema.integrationDeliveries.organisationId, subject.organisationId),
      )
      .orderBy(desc(schema.integrationDeliveries.createdAt))
      .limit(200);
    return rows.map(publicDelivery);
  }

  async get(subject: AuthorisationSubject, id: string) {
    const [delivery] = await this.db
      .select()
      .from(schema.integrationDeliveries)
      .where(
        and(
          eq(
            schema.integrationDeliveries.organisationId,
            subject.organisationId,
          ),
          eq(schema.integrationDeliveries.id, id),
        ),
      )
      .limit(1);
    if (!delivery)
      throw new ApiProblem(
        404,
        "Action not found",
        "Integration action does not exist.",
      );
    return publicDelivery(delivery);
  }
}

export class ApprovalDomainService {
  constructor(private readonly db = database()) {}

  /**
   * Move overdue pending approvals to `expired` before anyone reads them.
   *
   * Nothing else transitions them, so without this they stay `pending`
   * forever: the inbox keeps offering Approve on a request that can no longer
   * be approved, and the attention queue keeps counting dead rows. Lazy
   * expiry runs on read so a workspace self-heals without a scheduler.
   */
  async expireOverdue(organisationId: string, traceId: string) {
    return this.db.transaction(async (tx) => {
      const overdue = await tx
        .update(schema.approvals)
        .set({ status: "expired", decisionAt: new Date() })
        .where(
          and(
            eq(schema.approvals.organisationId, organisationId),
            eq(schema.approvals.status, "pending"),
            lte(schema.approvals.expiresAt, new Date()),
          ),
        )
        .returning({
          id: schema.approvals.id,
          actionType: schema.approvals.actionType,
          requestingActorId: schema.approvals.requestingActorId,
        });
      for (const approval of overdue) {
        await appendAuditEvent(tx, {
          organisationId,
          actorId: approval.requestingActorId,
          actorType: "system",
          action: "workflow.approval.expired",
          targetType: "approval",
          targetId: approval.id,
          metadata: { actionType: approval.actionType },
          traceId,
        });
      }
      return overdue.length;
    });
  }

  async list(subject: AuthorisationSubject, traceId = "approval-list") {
    requireCapability(subject, "workflows.approve");
    await this.expireOverdue(subject.organisationId, traceId);
    const rows = await this.db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.organisationId, subject.organisationId))
      .orderBy(desc(schema.approvals.requestedAt))
      .limit(200);
    return rows;
  }

  async decide(
    subject: AuthorisationSubject,
    approvalId: string,
    raw: unknown,
    traceId: string,
  ) {
    requireCapability(subject, "workflows.approve");
    const decision = DecisionSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      const [approval] = await tx
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.organisationId, subject.organisationId),
            eq(schema.approvals.id, approvalId),
          ),
        )
        .for("update")
        .limit(1);
      if (!approval)
        throw new ApiProblem(
          404,
          "Approval not found",
          "Approval does not exist.",
        );
      if (approval.status !== "pending")
        return { id: approval.id, status: approval.status, duplicate: true };
      // Approving an expired dangerous action is exactly what expiry exists to
      // prevent. Rejecting one is strictly de-escalating, so it stays open —
      // otherwise the row can never be closed and clutters the queue forever.
      if (approval.expiresAt <= new Date() && decision.status !== "rejected") {
        throw new ApiProblem(
          409,
          "Approval expired",
          "This approval expired and can no longer be approved. Reject it to close it out.",
        );
      }
      if (!capabilities.includes(approval.requiredCapability as Capability))
        throw new Error("Approval requires an unknown capability");
      requireCapability(subject, approval.requiredCapability as Capability);
      const existing = z
        .array(
          z.object({
            actorId: z.uuid(),
            status: z.enum(["approved", "rejected"]),
            reason: z.string(),
            decidedAt: z.string(),
          }),
        )
        .parse(approval.decisions);
      if (existing.some((item) => item.actorId === subject.actorId))
        return { id: approval.id, status: approval.status, duplicate: true };
      const decisions = [
        ...existing,
        {
          actorId: subject.actorId,
          status: decision.status,
          reason: decision.reason,
          decidedAt: new Date().toISOString(),
        },
      ];
      const approved = new Set(
        decisions
          .filter((item) => item.status === "approved")
          .map((item) => item.actorId),
      ).size;
      const status =
        decision.status === "rejected"
          ? ("rejected" as const)
          : approved >= approval.requiredApprovalCount
            ? ("approved" as const)
            : ("pending" as const);
      await tx
        .update(schema.approvals)
        .set({
          decisions,
          status,
          reason: decision.reason,
          ...(status !== "pending" ? { decisionAt: new Date() } : {}),
        })
        .where(
          and(
            eq(schema.approvals.organisationId, subject.organisationId),
            eq(schema.approvals.id, approval.id),
          ),
        );
      const deliveryTarget = z
        .object({ deliveryId: z.uuid() })
        .passthrough()
        .safeParse(approval.target);
      const huntTarget = z
        .object({ huntId: z.uuid(), agentRunId: z.uuid() })
        .passthrough()
        .safeParse(approval.target);
      const reportEmailTarget = z
        .object({ deliveryId: z.uuid(), reportId: z.uuid() })
        .passthrough()
        .safeParse(approval.target);
      if (
        deliveryTarget.success &&
        approval.actionType !== "report.email.dispatch" &&
        status === "approved"
      ) {
        await tx
          .update(schema.integrationDeliveries)
          .set({ status: "queued", updatedAt: new Date() })
          .where(
            and(
              eq(
                schema.integrationDeliveries.organisationId,
                subject.organisationId,
              ),
              eq(
                schema.integrationDeliveries.id,
                deliveryTarget.data.deliveryId,
              ),
            ),
          );
        await writeOutbox(tx, {
          organisationId: subject.organisationId,
          eventType: "integration.action.queued",
          aggregateType: "integration_delivery",
          aggregateId: deliveryTarget.data.deliveryId,
          queueName: "muster-integrations",
          payload: { deliveryId: deliveryTarget.data.deliveryId },
          idempotencyKey: `integration.action:${deliveryTarget.data.deliveryId}`,
          traceId,
        });
      } else if (
        deliveryTarget.success &&
        approval.actionType !== "report.email.dispatch" &&
        status === "rejected"
      ) {
        await tx
          .update(schema.integrationDeliveries)
          .set({
            status: "rejected",
            error: "Human approval rejected the external action.",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(
                schema.integrationDeliveries.organisationId,
                subject.organisationId,
              ),
              eq(
                schema.integrationDeliveries.id,
                deliveryTarget.data.deliveryId,
              ),
            ),
          );
      } else if (huntTarget.success && status === "approved") {
        const queryRuns = await tx
          .update(schema.integrationQueryRuns)
          .set({ status: "queued", updatedAt: new Date() })
          .where(
            and(
              eq(
                schema.integrationQueryRuns.organisationId,
                subject.organisationId,
              ),
              inArray(
                schema.integrationQueryRuns.id,
                tx
                  .select({ id: schema.huntQueries.queryRunId })
                  .from(schema.huntQueries)
                  .where(
                    and(
                      eq(
                        schema.huntQueries.organisationId,
                        subject.organisationId,
                      ),
                      eq(schema.huntQueries.huntId, huntTarget.data.huntId),
                    ),
                  ),
              ),
              eq(schema.integrationQueryRuns.status, "planned"),
            ),
          )
          .returning({ id: schema.integrationQueryRuns.id });
        await tx
          .update(schema.huntRuns)
          .set({ status: "querying", updatedAt: new Date() })
          .where(
            and(
              eq(schema.huntRuns.organisationId, subject.organisationId),
              eq(schema.huntRuns.id, huntTarget.data.huntId),
            ),
          );
        await tx
          .update(schema.agentRuns)
          .set({
            status: "waiting_sources",
            progress: { stage: "querying", percent: 5 },
          })
          .where(
            and(
              eq(schema.agentRuns.organisationId, subject.organisationId),
              eq(schema.agentRuns.id, huntTarget.data.agentRunId),
            ),
          );
        await tx
          .update(schema.tasks)
          .set({ agentRunStatus: "waiting_sources", updatedAt: new Date() })
          .where(
            and(
              eq(schema.tasks.organisationId, subject.organisationId),
              eq(schema.tasks.agentRunId, huntTarget.data.agentRunId),
            ),
          );
        await tx.insert(schema.agentRunEvents).values({
          id: newId(),
          organisationId: subject.organisationId,
          runId: huntTarget.data.agentRunId,
          eventType: "approved",
          message: "Human approved the exact bounded hunt plan",
          payload: {
            approvalId: approval.id,
            huntId: huntTarget.data.huntId,
            queryCount: queryRuns.length,
          },
        });
        for (const queryRun of queryRuns) {
          await writeOutbox(tx, {
            organisationId: subject.organisationId,
            eventType: "connector.query.queued",
            aggregateType: "integration_query",
            aggregateId: queryRun.id,
            queueName: "muster-integrations",
            payload: {
              queryRunId: queryRun.id,
              huntId: huntTarget.data.huntId,
            },
            idempotencyKey: `connector.query:jessie-hunt:${queryRun.id}`,
            traceId,
          });
        }
      } else if (huntTarget.success && status === "rejected") {
        await tx
          .update(schema.huntRuns)
          .set({
            status: "cancelled",
            error: "Human approval rejected the hunt plan.",
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.huntRuns.organisationId, subject.organisationId),
              eq(schema.huntRuns.id, huntTarget.data.huntId),
            ),
          );
        await tx
          .update(schema.agentRuns)
          .set({
            status: "cancelled",
            cancellationReason: "Human approval rejected the hunt plan.",
            completedAt: new Date(),
            progress: { stage: "cancelled", percent: 100 },
          })
          .where(
            and(
              eq(schema.agentRuns.organisationId, subject.organisationId),
              eq(schema.agentRuns.id, huntTarget.data.agentRunId),
            ),
          );
        await tx
          .update(schema.integrationQueryRuns)
          .set({
            status: "cancelled",
            errorCode: "approval_rejected",
            errorMessage: "Human approval rejected the hunt plan.",
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(
                schema.integrationQueryRuns.organisationId,
                subject.organisationId,
              ),
              inArray(
                schema.integrationQueryRuns.id,
                tx
                  .select({ id: schema.huntQueries.queryRunId })
                  .from(schema.huntQueries)
                  .where(
                    and(
                      eq(
                        schema.huntQueries.organisationId,
                        subject.organisationId,
                      ),
                      eq(schema.huntQueries.huntId, huntTarget.data.huntId),
                    ),
                  ),
              ),
              eq(schema.integrationQueryRuns.status, "planned"),
            ),
          );
        await tx
          .update(schema.tasks)
          .set({
            status: "ready",
            agentRunStatus: "cancelled",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.tasks.organisationId, subject.organisationId),
              eq(schema.tasks.agentRunId, huntTarget.data.agentRunId),
            ),
          );
      } else if (reportEmailTarget.success && status === "approved") {
        await tx
          .update(schema.reportDeliveries)
          .set({ status: "queued", updatedAt: new Date() })
          .where(
            and(
              eq(schema.reportDeliveries.organisationId, subject.organisationId),
              eq(schema.reportDeliveries.id, reportEmailTarget.data.deliveryId),
            ),
          );
        await writeOutbox(tx, {
          organisationId: subject.organisationId,
          eventType: "report.email.queued",
          aggregateType: "report_delivery",
          aggregateId: reportEmailTarget.data.deliveryId,
          queueName: "muster-notifications",
          payload: { deliveryId: reportEmailTarget.data.deliveryId },
          idempotencyKey: `report.email:${reportEmailTarget.data.deliveryId}`,
          traceId,
        });
      } else if (reportEmailTarget.success && status === "rejected") {
        await tx
          .update(schema.reportDeliveries)
          .set({
            status: "cancelled",
            result: { code: "approval_rejected" },
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.reportDeliveries.organisationId, subject.organisationId),
              eq(schema.reportDeliveries.id, reportEmailTarget.data.deliveryId),
            ),
          );
      }
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: `workflow.approval.${decision.status}`,
        targetType: "approval",
        targetId: approval.id,
        metadata: {
          actionType: approval.actionType,
          decisionCount: decisions.length,
          resultingStatus: status,
        },
        traceId,
      });
      return { id: approval.id, status, duplicate: false };
    });
  }
}
