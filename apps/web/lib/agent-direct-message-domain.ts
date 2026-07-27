import { createHash } from "node:crypto";
import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import { redactObservationText } from "@muster/config";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import { and, eq, gt, isNull, or } from "drizzle-orm";

type Db = ReturnType<typeof database>;

export type DirectMessageInvocation =
  | {
      handled: true;
      queued: false;
      duplicate: false;
      reason: "agent_count" | "agent_unavailable";
    }
  | {
      handled: true;
      queued: true;
      duplicate: boolean;
      agentId: string;
      agentRunId: string;
      status: string;
    };

export class AgentDirectMessageDomainService {
  constructor(private readonly db: Db = database()) {}

  async maybeQueue(
    subject: AuthorisationSubject,
    input: { messageId: string; roomId: string },
    traceId: string,
  ): Promise<DirectMessageInvocation | null> {
    const [source] = await this.db
      .select({
        plainText: schema.messages.plainText,
        relatedInvestigationId: schema.messages.relatedInvestigationId,
      })
      .from(schema.messages)
      .innerJoin(
        schema.rooms,
        and(
          eq(schema.rooms.organisationId, subject.organisationId),
          eq(schema.rooms.id, schema.messages.roomId),
          eq(schema.rooms.roomType, "direct"),
          isNull(schema.rooms.archivedAt),
        ),
      )
      .innerJoin(
        schema.roomMemberships,
        and(
          eq(schema.roomMemberships.organisationId, subject.organisationId),
          eq(schema.roomMemberships.roomId, schema.messages.roomId),
          eq(schema.roomMemberships.actorId, subject.actorId),
          or(
            isNull(schema.roomMemberships.accessExpiresAt),
            gt(schema.roomMemberships.accessExpiresAt, new Date()),
          ),
        ),
      )
      .innerJoin(
        schema.actors,
        and(
          eq(schema.actors.organisationId, subject.organisationId),
          eq(schema.actors.id, schema.messages.authorActorId),
          eq(schema.actors.id, subject.actorId),
          eq(schema.actors.actorType, "human"),
          eq(schema.actors.status, "active"),
        ),
      )
      .where(
        and(
          eq(schema.messages.organisationId, subject.organisationId),
          eq(schema.messages.id, input.messageId),
          eq(schema.messages.roomId, input.roomId),
          eq(schema.messages.messageType, "text"),
          isNull(schema.messages.deletedAt),
        ),
      )
      .limit(1);
    if (!source) return null;

    const members = await this.db
      .select({
        actorId: schema.actors.id,
        actorStatus: schema.actors.status,
        definitionId: schema.agentDefinitions.id,
        definitionStatus: schema.agentDefinitions.status,
        killSwitch: schema.agentDefinitions.killSwitch,
        allowedRooms: schema.agentDefinitions.allowedRooms,
        runtime: schema.agentDefinitions.runtime,
        model: schema.agentDefinitions.model,
        promptVersion: schema.agentDefinitions.systemPromptVersion,
        maximumRuntimeSeconds: schema.agentDefinitions.maximumRuntimeSeconds,
        maximumTokenBudget: schema.agentDefinitions.maximumTokenBudget,
        maximumCostCents: schema.agentDefinitions.maximumCostCents,
      })
      .from(schema.roomMemberships)
      .innerJoin(
        schema.actors,
        and(
          eq(schema.actors.organisationId, subject.organisationId),
          eq(schema.actors.id, schema.roomMemberships.actorId),
          eq(schema.actors.actorType, "agent"),
        ),
      )
      .leftJoin(
        schema.agentDefinitions,
        and(
          eq(schema.agentDefinitions.organisationId, subject.organisationId),
          eq(schema.agentDefinitions.id, schema.actors.id),
        ),
      )
      .where(
        and(
          eq(schema.roomMemberships.organisationId, subject.organisationId),
          eq(schema.roomMemberships.roomId, input.roomId),
          or(
            isNull(schema.roomMemberships.accessExpiresAt),
            gt(schema.roomMemberships.accessExpiresAt, new Date()),
          ),
        ),
      );
    if (members.length === 0) return null;

    const active = members.filter(
      (member) =>
        member.actorStatus === "active" &&
        member.definitionId !== null &&
        member.definitionStatus === "active" &&
        member.killSwitch === false,
    );
    if (active.length !== 1) {
      return {
        handled: true,
        queued: false,
        duplicate: false,
        reason: "agent_count",
      };
    }
    const agent = active[0]!;
    if (
      !Array.isArray(agent.allowedRooms) ||
      !agent.allowedRooms.includes(input.roomId) ||
      !agent.definitionId ||
      !agent.runtime ||
      !agent.model ||
      !agent.promptVersion ||
      agent.maximumRuntimeSeconds === null ||
      agent.maximumTokenBudget === null ||
      agent.maximumCostCents === null
    ) {
      return {
        handled: true,
        queued: false,
        duplicate: false,
        reason: "agent_unavailable",
      };
    }

    const agentId = agent.definitionId;
    const runtime = agent.runtime;
    const model = agent.model;
    const promptVersion = agent.promptVersion;
    const maximumRuntimeSeconds = agent.maximumRuntimeSeconds;
    const maximumTokenBudget = agent.maximumTokenBudget;
    const maximumCostCents = agent.maximumCostCents;
    requireCapability(subject, "agents.invoke");
    const idempotencyKey = `agent-direct-message:${input.messageId}`;
    const inputHash = createHash("sha256")
      .update(
        JSON.stringify({
          messageId: input.messageId,
          roomId: input.roomId,
          plainText: source.plainText,
        }),
      )
      .digest("hex");
    const deadlineAt = new Date(Date.now() + maximumRuntimeSeconds * 1_000);

    return this.db.transaction(async (tx) => {
      const eligible = await tx
        .select({
          id: schema.agentDefinitions.id,
          allowedRooms: schema.agentDefinitions.allowedRooms,
        })
        .from(schema.agentDefinitions)
        .innerJoin(
          schema.actors,
          and(
            eq(schema.actors.organisationId, subject.organisationId),
            eq(schema.actors.id, schema.agentDefinitions.id),
            eq(schema.actors.status, "active"),
          ),
        )
        .innerJoin(
          schema.roomMemberships,
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            eq(schema.roomMemberships.roomId, input.roomId),
            eq(schema.roomMemberships.actorId, schema.agentDefinitions.id),
            or(
              isNull(schema.roomMemberships.accessExpiresAt),
              gt(schema.roomMemberships.accessExpiresAt, new Date()),
            ),
          ),
        )
        .where(
          and(
            eq(schema.agentDefinitions.organisationId, subject.organisationId),
            eq(schema.agentDefinitions.status, "active"),
            eq(schema.agentDefinitions.killSwitch, false),
          ),
        );
      if (
        eligible.length !== 1 ||
        eligible[0]?.id !== agentId ||
        !Array.isArray(eligible[0].allowedRooms) ||
        !eligible[0].allowedRooms.includes(input.roomId)
      ) {
        throw new Error("Direct-message agent is unavailable");
      }

      const [inserted] = await tx
        .insert(schema.agentRuns)
        .values({
          id: newId(),
          agentId,
          organisationId: subject.organisationId,
          roomId: input.roomId,
          investigationId: source.relatedInvestigationId,
          requestedByActorId: subject.actorId,
          trigger: "direct_message",
          status: "queued",
          request: {
            kind: "direct_message",
            sourceMessageId: input.messageId,
            humanRequest: source.plainText,
            traceId,
          },
          progress: { stage: "queued", percent: 0 },
          deadlineAt,
          inputHash,
          promptVersion,
          runtime,
          model,
          maximumRuntimeSeconds,
          maximumTokenBudget,
          maximumCostCents,
          idempotencyKey,
        })
        .onConflictDoNothing()
        .returning();
      const run =
        inserted ??
        (
          await tx
            .select()
            .from(schema.agentRuns)
            .where(
              and(
                eq(schema.agentRuns.organisationId, subject.organisationId),
                eq(schema.agentRuns.idempotencyKey, idempotencyKey),
              ),
            )
            .limit(1)
        )[0];
      if (
        !run ||
        run.agentId !== agentId ||
        run.roomId !== input.roomId ||
        run.requestedByActorId !== subject.actorId ||
        run.inputHash !== inputHash
      ) {
        throw new Error("Direct-message run idempotency conflict");
      }
      if (inserted) {
        await tx.insert(schema.agentRunEvents).values({
          id: newId(),
          organisationId: subject.organisationId,
          runId: run.id,
          eventType: "queued",
          message: "Direct-message agent run queued",
          payload: {
            trigger: "direct_message",
            sourceMessageId: input.messageId,
            roomId: input.roomId,
          },
        });
        await appendAuditEvent(tx, {
          organisationId: subject.organisationId,
          actorId: subject.actorId,
          actorType: "human",
          action: "agent.run.queued",
          targetType: "agent_run",
          targetId: run.id,
          metadata: {
            trigger: "direct_message",
            sourceMessageId: input.messageId,
            roomId: input.roomId,
          },
          traceId: redactObservationText(traceId),
        });
        await writeOutbox(tx, {
          organisationId: subject.organisationId,
          eventType: "agent.run.queued",
          aggregateType: "agent_run",
          aggregateId: run.id,
          queueName: "muster-agents",
          payload: { runId: run.id },
          idempotencyKey: `agent.run.queued:${run.id}`,
          traceId: redactObservationText(traceId),
        });
      }
      return {
        handled: true,
        queued: true,
        duplicate: !inserted,
        agentId: run.agentId,
        agentRunId: run.id,
        status: run.status,
      };
    });
  }
}
