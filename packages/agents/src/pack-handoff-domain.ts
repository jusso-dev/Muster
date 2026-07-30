import { and, desc, eq, inArray } from "drizzle-orm";
import {
  evaluatePackHandoff,
  PACK_HANDOFF_APPROVAL_ACTION,
  type PackHandoffReason,
} from "./pack-handoff-policy.ts";
import {
  actionApprovalPolicy,
  capabilities as knownCapabilities,
  assertExecutableApproval,
  type AuthorisationSubject,
} from "@muster/authz";
import { redactObservationText } from "@muster/config";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";

/**
 * Transport-neutral failure so the same domain serves the HTTP API and the
 * remote MCP server. Each edge maps this to its own error shape.
 */
export class PackHandoffError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "PackHandoffError";
  }
}

export const PACK_HANDOFF_SUMMARY_MAX = 4_000;
export const PACK_HANDOFF_MAX_CAPABILITIES = 20;
export const PACK_HANDOFF_MAX_EVIDENCE_REFS = 50;
/** Approval window for a high-risk handoff. Short by design. */
const PACK_HANDOFF_APPROVAL_TTL_MS = 60 * 60 * 1_000;

export type PackHandoffStatus =
  | "pending"
  | "awaiting_approval"
  | "accepted"
  | "rejected"
  | "blocked"
  | "dispatched"
  | "cancelled";

export type PackHandoffRequest = {
  idempotencyKey: string;
  fromAgentActorId: string;
  toAgentActorId: string;
  reason: PackHandoffReason;
  summary: string;
  requestedCapabilities?: string[] | undefined;
  evidenceReferences?: string[] | undefined;
  sourceRunId?: string | null | undefined;
  taskId?: string | null | undefined;
  missionId?: string | null | undefined;
  roomId?: string | null | undefined;
};

export type PackHandoffRecord = {
  id: string;
  status: PackHandoffStatus;
  reason: string;
  summary: string;
  fromAgent: string;
  toAgent: string;
  requestedCapabilities: string[];
  evidenceReferences: string[];
  blockedReason: string | null;
  approvalId: string | null;
  sourceRunId: string | null;
  targetRunId: string | null;
  taskId: string | null;
  missionId: string | null;
  roomId: string | null;
  createdAt: string;
  decidedAt: string | null;
  dispatchedAt: string | null;
};

type Database = ReturnType<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Bound and strip a free-text brief before it is persisted. A handoff summary
 * is written by an agent, so it is treated as hostile input: secrets removed,
 * control characters flattened, length capped.
 */
export function sanitiseHandoffSummary(value: string): string {
  const safe = redactObservationText(value, {
    maxStringLength: PACK_HANDOFF_SUMMARY_MAX,
  })
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
      " ",
    )
    .replace(/[ \t]+/g, " ")
    .trim();
  return safe;
}

async function loadPackAgent(
  tx: Transaction,
  organisationId: string,
  actorId: string,
  label: string,
) {
  const [agent] = await tx
    .select({
      id: schema.actors.id,
      name: schema.agentDefinitions.name,
      status: schema.agentDefinitions.status,
      killSwitch: schema.agentDefinitions.killSwitch,
    })
    .from(schema.actors)
    .innerJoin(
      schema.agentDefinitions,
      and(
        eq(schema.agentDefinitions.id, schema.actors.id),
        eq(schema.agentDefinitions.organisationId, schema.actors.organisationId),
      ),
    )
    .where(
      and(
        eq(schema.actors.id, actorId),
        eq(schema.actors.organisationId, organisationId),
        eq(schema.actors.actorType, "agent"),
      ),
    )
    .limit(1);
  if (!agent) {
    throw new PackHandoffError(
      404,
      "Not found",
      `Handoff ${label} agent not found in this organisation.`,
    );
  }
  return agent;
}

async function assertOwned(
  tx: Transaction,
  table:
    | typeof schema.tasks
    | typeof schema.rooms
    | typeof schema.governedMissions
    | typeof schema.agentRuns,
  id: string,
  organisationId: string,
  label: string,
) {
  const [row] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.organisationId, organisationId)))
    .limit(1);
  if (!row) throw new PackHandoffError(404, "Not found", `Handoff ${label} not found.`);
}

/**
 * Request a governed agent-to-agent handoff.
 *
 * A policy denial is persisted as a `blocked` row rather than thrown away, so
 * operators can see refused routes as attention items instead of discovering
 * them only in logs.
 */
export async function requestPackHandoff(
  subject: AuthorisationSubject,
  input: PackHandoffRequest,
  traceId: string,
): Promise<{ id: string; status: PackHandoffStatus; duplicate: boolean; detail: string | null }> {
  const summary = sanitiseHandoffSummary(input.summary);
  if (!summary) {
    throw new PackHandoffError(
      400,
      "Invalid handoff",
      "Handoff summary is empty after redaction.",
    );
  }
  const requestedCapabilities = [
    ...new Set(input.requestedCapabilities ?? []),
  ].slice(0, PACK_HANDOFF_MAX_CAPABILITIES);
  const evidenceReferences = [...new Set(input.evidenceReferences ?? [])]
    .slice(0, PACK_HANDOFF_MAX_EVIDENCE_REFS)
    .map((reference) => reference.slice(0, 500));

  return database().transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.packHandoffs.id, status: schema.packHandoffs.status })
      .from(schema.packHandoffs)
      .where(
        and(
          eq(schema.packHandoffs.organisationId, subject.organisationId),
          eq(schema.packHandoffs.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        id: existing.id,
        status: existing.status as PackHandoffStatus,
        duplicate: true,
        detail: null,
      };
    }

    const from = await loadPackAgent(
      tx,
      subject.organisationId,
      input.fromAgentActorId,
      "source",
    );
    const to = await loadPackAgent(
      tx,
      subject.organisationId,
      input.toAgentActorId,
      "target",
    );
    if (input.taskId)
      await assertOwned(tx, schema.tasks, input.taskId, subject.organisationId, "task");
    if (input.roomId)
      await assertOwned(tx, schema.rooms, input.roomId, subject.organisationId, "room");
    if (input.missionId)
      await assertOwned(
        tx,
        schema.governedMissions,
        input.missionId,
        subject.organisationId,
        "mission",
      );
    if (input.sourceRunId)
      await assertOwned(
        tx,
        schema.agentRuns,
        input.sourceRunId,
        subject.organisationId,
        "source run",
      );

    const decision = evaluatePackHandoff({
      from: from.name,
      to: to.name,
      reason: input.reason,
      requestedCapabilities,
      knownCapabilities,
    });

    const id = newId();
    let status: PackHandoffStatus;
    let blockedReason: string | null = null;
    let approvalId: string | null = null;
    let detail: string | null = null;

    if (!decision.allowed) {
      status = "blocked";
      blockedReason = `${decision.code}: ${decision.detail}`;
      detail = decision.detail;
    } else if (to.status !== "active" || to.killSwitch) {
      status = "blocked";
      blockedReason = `target_unavailable: ${to.name} is not accepting work.`;
      detail = `${to.name} is not accepting work.`;
    } else if (decision.requiresApproval) {
      status = "awaiting_approval";
      approvalId = newId();
      const policy = actionApprovalPolicy[PACK_HANDOFF_APPROVAL_ACTION];
      await tx.insert(schema.approvals).values({
        id: approvalId,
        organisationId: subject.organisationId,
        requestingActorId: subject.actorId,
        actionType: PACK_HANDOFF_APPROVAL_ACTION,
        target: { packHandoffId: id, fromAgent: from.name, toAgent: to.name },
        riskSummary:
          decision.highRiskCapabilities.length > 0
            ? `Handoff would let ${to.name} act with ${decision.highRiskCapabilities.join(", ")}.`
            : `Response-reason handoff to ${to.name} requires a human decision before dispatch.`,
        expiresAt: new Date(Date.now() + PACK_HANDOFF_APPROVAL_TTL_MS),
        requiredCapability: policy.capability,
        requiredApprovalCount: policy.approvalCount,
        idempotencyKey: `pack-handoff-approval:${input.idempotencyKey}`,
      });
      detail = "Approval required before dispatch.";
    } else {
      status = "accepted";
    }

    await tx.insert(schema.packHandoffs).values({
      id,
      organisationId: subject.organisationId,
      fromAgentActorId: from.id,
      toAgentActorId: to.id,
      requestedByActorId: subject.actorId,
      reason: input.reason,
      status,
      summary,
      requestedCapabilities,
      evidenceReferences,
      sourceRunId: input.sourceRunId ?? null,
      taskId: input.taskId ?? null,
      missionId: input.missionId ?? null,
      roomId: input.roomId ?? null,
      approvalId,
      blockedReason,
      idempotencyKey: input.idempotencyKey,
    });

    await appendAuditEvent(tx, {
      organisationId: subject.organisationId,
      actorId: subject.actorId,
      actorType: "human",
      action:
        status === "blocked"
          ? "pack_handoff.blocked"
          : "pack_handoff.requested",
      targetType: "pack_handoff",
      targetId: id,
      metadata: {
        fromAgent: from.name,
        toAgent: to.name,
        reason: input.reason,
        status,
        requestedCapabilities,
        blockedReason,
        approvalId,
      },
      traceId,
    });

    if (status === "accepted") {
      await queueHandoffDispatch(tx, subject.organisationId, id, traceId);
    }

    return { id, status, duplicate: false, detail };
  });
}

function queueHandoffDispatch(
  tx: Transaction,
  organisationId: string,
  handoffId: string,
  traceId: string,
) {
  return writeOutbox(tx, {
    organisationId,
    eventType: "pack_handoff.accepted",
    aggregateType: "pack_handoff",
    aggregateId: handoffId,
    queueName: "muster-agents",
    payload: { packHandoffId: handoffId },
    idempotencyKey: `pack_handoff.accepted:${handoffId}`,
    traceId,
  });
}

/**
 * Human decision on a high-risk handoff. Accepting requires the approval row
 * to already carry enough distinct approvals — this never self-approves.
 */
export async function decidePackHandoff(
  subject: AuthorisationSubject,
  handoffId: string,
  decision: { status: "accepted" | "rejected"; reason: string },
  traceId: string,
): Promise<{ id: string; status: PackHandoffStatus }> {
  return database().transaction(async (tx) => {
    const [handoff] = await tx
      .select()
      .from(schema.packHandoffs)
      .where(
        and(
          eq(schema.packHandoffs.id, handoffId),
          eq(schema.packHandoffs.organisationId, subject.organisationId),
        ),
      )
      .limit(1);
    if (!handoff) throw new PackHandoffError(404, "Not found", "Handoff not found.");
    if (handoff.status !== "awaiting_approval") {
      throw new PackHandoffError(
        409,
        "Not decidable",
        `Handoff is ${handoff.status}, not awaiting approval.`,
      );
    }

    if (decision.status === "accepted") {
      if (!handoff.approvalId) {
        throw new PackHandoffError(
          409,
          "Approval missing",
          "Handoff has no approval record to satisfy.",
        );
      }
      const [approval] = await tx
        .select({
          decisions: schema.approvals.decisions,
          status: schema.approvals.status,
        })
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.id, handoff.approvalId),
            eq(schema.approvals.organisationId, subject.organisationId),
          ),
        )
        .limit(1);
      if (!approval)
        throw new PackHandoffError(404, "Not found", "Approval record not found.");
      const decisions = Array.isArray(approval.decisions)
        ? (approval.decisions as Array<{
            actorId: string;
            status: "approved" | "rejected";
          }>)
        : [];
      assertExecutableApproval(PACK_HANDOFF_APPROVAL_ACTION, decisions);
    }

    const status: PackHandoffStatus =
      decision.status === "accepted" ? "accepted" : "rejected";
    await tx
      .update(schema.packHandoffs)
      .set({
        status,
        decidedByActorId: subject.actorId,
        decidedAt: new Date(),
        blockedReason:
          decision.status === "rejected"
            ? `rejected: ${sanitiseHandoffSummary(decision.reason).slice(0, 500)}`
            : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.packHandoffs.id, handoffId),
          eq(schema.packHandoffs.organisationId, subject.organisationId),
          eq(schema.packHandoffs.status, "awaiting_approval"),
        ),
      );

    await appendAuditEvent(tx, {
      organisationId: subject.organisationId,
      actorId: subject.actorId,
      actorType: "human",
      action:
        status === "accepted"
          ? "pack_handoff.accepted"
          : "pack_handoff.rejected",
      targetType: "pack_handoff",
      targetId: handoffId,
      metadata: { approvalId: handoff.approvalId, status },
      traceId,
    });

    if (status === "accepted") {
      await queueHandoffDispatch(tx, subject.organisationId, handoffId, traceId);
    }
    return { id: handoffId, status };
  });
}

export async function listPackHandoffs(
  organisationId: string,
  filters: {
    taskId?: string;
    missionId?: string;
    roomId?: string;
    statuses?: PackHandoffStatus[];
    limit?: number;
  } = {},
): Promise<PackHandoffRecord[]> {
  const db = database();
  const fromAgent = schema.actors;
  const conditions = [eq(schema.packHandoffs.organisationId, organisationId)];
  if (filters.taskId)
    conditions.push(eq(schema.packHandoffs.taskId, filters.taskId));
  if (filters.missionId)
    conditions.push(eq(schema.packHandoffs.missionId, filters.missionId));
  if (filters.roomId)
    conditions.push(eq(schema.packHandoffs.roomId, filters.roomId));
  if (filters.statuses?.length)
    conditions.push(inArray(schema.packHandoffs.status, filters.statuses));

  const rows = await db
    .select({
      handoff: schema.packHandoffs,
      fromName: fromAgent.displayName,
    })
    .from(schema.packHandoffs)
    .innerJoin(
      fromAgent,
      and(
        eq(fromAgent.id, schema.packHandoffs.fromAgentActorId),
        eq(fromAgent.organisationId, schema.packHandoffs.organisationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.packHandoffs.createdAt))
    .limit(Math.min(filters.limit ?? 50, 200));

  const targetIds = [...new Set(rows.map((row) => row.handoff.toAgentActorId))];
  const targets = targetIds.length
    ? await db
        .select({
          id: schema.actors.id,
          displayName: schema.actors.displayName,
        })
        .from(schema.actors)
        .where(
          and(
            eq(schema.actors.organisationId, organisationId),
            inArray(schema.actors.id, targetIds),
          ),
        )
    : [];
  const targetNames = new Map(
    targets.map((target) => [target.id, target.displayName]),
  );

  return rows.map(({ handoff, fromName }) => ({
    id: handoff.id,
    status: handoff.status as PackHandoffStatus,
    reason: handoff.reason,
    summary: handoff.summary,
    fromAgent: fromName,
    toAgent: targetNames.get(handoff.toAgentActorId) ?? "unknown",
    requestedCapabilities: Array.isArray(handoff.requestedCapabilities)
      ? (handoff.requestedCapabilities as string[])
      : [],
    evidenceReferences: Array.isArray(handoff.evidenceReferences)
      ? (handoff.evidenceReferences as string[])
      : [],
    blockedReason: handoff.blockedReason,
    approvalId: handoff.approvalId,
    sourceRunId: handoff.sourceRunId,
    targetRunId: handoff.targetRunId,
    taskId: handoff.taskId,
    missionId: handoff.missionId,
    roomId: handoff.roomId,
    createdAt: handoff.createdAt.toISOString(),
    decidedAt: handoff.decidedAt?.toISOString() ?? null,
    dispatchedAt: handoff.dispatchedAt?.toISOString() ?? null,
  }));
}
