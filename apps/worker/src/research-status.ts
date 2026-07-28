import { database, newId, schema, writeOutbox } from "@muster/database";
import { and, eq, isNull } from "drizzle-orm";

type Transaction = Parameters<
  Parameters<ReturnType<typeof database>["transaction"]>[0]
>[0];

export type ResearchTerminalMessageKind = "failed" | "no_changes";

export function researchTerminalMessageText(kind: ResearchTerminalMessageKind) {
  return kind === "failed"
    ? "Alfie research could not complete after the final retry. No feed content was posted. Review the agent run before retrying."
    : "Alfie research completed. No new or changed findings were found.";
}

export async function appendResearchTerminalMessage(
  tx: Transaction,
  input: {
    organisationId: string;
    researchRunId: string;
    kind: ResearchTerminalMessageKind;
    traceId: string;
  },
) {
  const expectedStatus = input.kind === "failed" ? "failed" : "completed";
  const [run] = await tx
    .select({
      agentRunId: schema.researchRuns.agentRunId,
      agentId: schema.agentRuns.agentId,
      roomId: schema.researchWatchlists.roomId,
      structuredOutput: schema.agentRuns.structuredOutput,
    })
    .from(schema.researchRuns)
    .innerJoin(
      schema.researchWatchlists,
      and(
        eq(schema.researchWatchlists.organisationId, input.organisationId),
        eq(schema.researchWatchlists.id, schema.researchRuns.watchlistId),
      ),
    )
    .innerJoin(
      schema.rooms,
      and(
        eq(schema.rooms.organisationId, input.organisationId),
        eq(schema.rooms.id, schema.researchWatchlists.roomId),
        isNull(schema.rooms.archivedAt),
      ),
    )
    .innerJoin(
      schema.agentRuns,
      and(
        eq(schema.agentRuns.organisationId, input.organisationId),
        eq(schema.agentRuns.id, schema.researchRuns.agentRunId),
        eq(schema.agentRuns.status, expectedStatus),
      ),
    )
    .innerJoin(
      schema.roomMemberships,
      and(
        eq(schema.roomMemberships.organisationId, input.organisationId),
        eq(schema.roomMemberships.roomId, schema.researchWatchlists.roomId),
        eq(schema.roomMemberships.actorId, schema.agentRuns.agentId),
      ),
    )
    .where(
      and(
        eq(schema.researchRuns.organisationId, input.organisationId),
        eq(schema.researchRuns.id, input.researchRunId),
        eq(schema.researchRuns.status, expectedStatus),
      ),
    )
    .limit(1);
  if (!run) return null;

  if (input.kind === "no_changes") {
    const output =
      run.structuredOutput !== null &&
      typeof run.structuredOutput === "object" &&
      !Array.isArray(run.structuredOutput)
        ? (run.structuredOutput as Record<string, unknown>)
        : null;
    if (output?.posted !== 0) return null;
  }

  const messageId = newId();
  const [message] = await tx
    .insert(schema.messages)
    .values({
      id: messageId,
      organisationId: input.organisationId,
      roomId: run.roomId,
      authorActorId: run.agentId,
      messageType: "agent-status",
      document: {
        type: "research-run-status",
        researchRunId: input.researchRunId,
        agentRunId: run.agentRunId,
        status: input.kind === "failed" ? "failed" : "completed_no_changes",
        ...(input.kind === "failed"
          ? { failureCode: "research_feed_failed" }
          : {}),
        trust: "agent-status",
      },
      plainText: researchTerminalMessageText(input.kind),
      dataClassification: "internal",
      relatedAgentRunId: run.agentRunId,
      idempotencyKey: `research.status.message:${input.researchRunId}`,
    })
    .onConflictDoNothing()
    .returning({ id: schema.messages.id });
  if (!message) return null;

  await writeOutbox(tx, {
    organisationId: input.organisationId,
    eventType: "room.message.created",
    aggregateType: "message",
    aggregateId: message.id,
    queueName: "muster-outbox",
    payload: { messageId: message.id, roomId: run.roomId },
    idempotencyKey: `room.message.created:research-status:${input.researchRunId}`,
    traceId: input.traceId,
  });
  return message.id;
}
