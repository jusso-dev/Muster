import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { redactObservationText, TRUNCATION_MARKER } from "@muster/config";
import { database, schema } from "@muster/database";

export const AGENT_HANDOFF_MAX_OUTPUT_BYTES = 32_000;
export const AGENT_HANDOFF_MAX_ARTIFACTS = 3;
export const AGENT_HANDOFF_OUTCOME_MAX = 360;
export const AGENT_HANDOFF_REQUEST_MAX = 240;
export const AGENT_HANDOFF_BLOCKER_MAX = 240;

export type AgentHandoffDisposition =
  "completed" | "partial" | "failed" | "cancelled" | "blocked";

export type AgentHandoff = {
  taskId: string;
  runId: string;
  roomId: string | null;
  disposition: AgentHandoffDisposition;
  outcome: string;
  requestedOutcome: string;
  verificationSummary: string;
  blocker: string | null;
  completedAt: string;
  artifacts: Array<{
    id: string;
    label: string;
    mimeType: string;
    href: string;
  }>;
};

export type HandoffTaskRecord = {
  id: string;
  organisationId: string;
  title: string;
  description: string;
  roomId: string | null;
  agentRunId: string | null;
  agentRunStatus: string | null;
};

export type HandoffRunRecord = {
  id: string;
  organisationId: string;
  roomId: string | null;
  status: string;
  request: unknown;
  structuredOutput: unknown;
  failureCode: string | null;
  error: string | null;
  cancellationReason: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type HandoffEventRecord = {
  organisationId: string;
  runId: string;
  eventType: string;
  message: string;
  createdAt: Date;
};

export type HandoffEvidenceRecord = {
  id: string;
  organisationId: string;
  relatedRoomId: string | null;
  fileName: string;
  mimeType: string;
  scanState: string;
  retentionState: string;
};

const terminalStatuses = [
  "completed",
  "partial",
  "partially_completed",
  "failed",
  "cancelled",
  "blocked",
] as const;

const verificationEventTypes = new Set([
  "evidence_verified",
  "validated",
  "verification_completed",
  "verification_passed",
]);

const uuidPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const limit = Math.max(1, maximum - TRUNCATION_MARKER.length);
  const safe = redactObservationText(value, { maxStringLength: limit })
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return safe || null;
}

function firstText(
  source: Record<string, unknown> | null,
  keys: string[],
  maximum: number,
): string | null {
  for (const key of keys) {
    const value = safeText(source?.[key], maximum);
    if (value) return value;
  }
  return null;
}

function outputSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function explicitDisposition(
  run: HandoffRunRecord,
  output: Record<string, unknown> | null,
): AgentHandoffDisposition | null {
  const outputDisposition =
    typeof output?.disposition === "string"
      ? output.disposition.toLowerCase()
      : typeof output?.status === "string"
        ? output.status.toLowerCase()
        : "";
  const failureCode = run.failureCode?.toLowerCase() ?? "";

  if (
    run.status === "blocked" ||
    outputDisposition === "blocked" ||
    failureCode === "blocked" ||
    failureCode.startsWith("blocked_")
  ) {
    return "blocked";
  }
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "failed") return "failed";
  if (
    run.status === "partial" ||
    run.status === "partially_completed" ||
    outputDisposition === "partial" ||
    outputDisposition === "partially_completed"
  ) {
    return "partial";
  }
  if (run.status === "completed") return "completed";
  return null;
}

function collectEvidenceIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (current: unknown, depth: number) => {
    if (depth > 5 || current === null || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.slice(0, 100).forEach((item) => visit(item, depth + 1));
      return;
    }
    for (const [key, nested] of Object.entries(
      current as Record<string, unknown>,
    ).slice(0, 100)) {
      if (
        (key === "reference" || key === "evidenceId") &&
        typeof nested === "string"
      ) {
        const matches = nested.match(uuidPattern) ?? [];
        matches.forEach((id) => ids.add(id.toLowerCase()));
      }
      if (
        key === "evidenceReferences" ||
        key === "testEvidenceReferences" ||
        key === "items"
      ) {
        visit(nested, depth + 1);
      }
    }
  };
  visit(value, 0);
  return [...ids];
}

export function buildAgentHandoff(
  organisationId: string,
  task: HandoffTaskRecord,
  run: HandoffRunRecord,
  events: HandoffEventRecord[],
  evidence: HandoffEvidenceRecord[],
): AgentHandoff | null {
  if (
    task.organisationId !== organisationId ||
    run.organisationId !== organisationId ||
    task.agentRunId !== run.id ||
    task.agentRunStatus !== run.status ||
    task.roomId !== run.roomId ||
    !run.completedAt ||
    (run.startedAt && run.completedAt < run.startedAt)
  ) {
    return null;
  }

  const output = record(run.structuredOutput);
  const disposition = explicitDisposition(run, output);
  if (!disposition) return null;
  if (
    (disposition === "completed" || disposition === "partial") &&
    (!output ||
      outputSize(run.structuredOutput) > AGENT_HANDOFF_MAX_OUTPUT_BYTES)
  ) {
    return null;
  }

  const request = record(run.request);
  const requestedOutcome =
    firstText(
      request,
      ["humanRequest", "requestedOutcome"],
      AGENT_HANDOFF_REQUEST_MAX,
    ) ??
    safeText(task.description, AGENT_HANDOFF_REQUEST_MAX) ??
    safeText(task.title, AGENT_HANDOFF_REQUEST_MAX);
  if (!requestedOutcome) return null;

  const resultOutcome = firstText(
    output,
    ["summary", "headline", "rationale", "impact", "title"],
    AGENT_HANDOFF_OUTCOME_MAX,
  );
  const blocker = firstText(
    output,
    ["blocker", "blockedReason"],
    AGENT_HANDOFF_BLOCKER_MAX,
  );
  const safeError = safeText(run.error, AGENT_HANDOFF_BLOCKER_MAX);
  const safeCancellation = safeText(
    run.cancellationReason,
    AGENT_HANDOFF_BLOCKER_MAX,
  );
  const outcome =
    disposition === "cancelled"
      ? (safeCancellation ?? "Agent work was cancelled before completion.")
      : disposition === "failed"
        ? (safeError ?? "Agent work failed without a safe result summary.")
        : disposition === "blocked"
          ? (resultOutcome ?? "Agent work stopped at a recorded blocker.")
          : resultOutcome;
  if (!outcome) return null;

  const referencedEvidence = new Set(collectEvidenceIds(run.structuredOutput));
  const artifacts = evidence
    .filter(
      (item) =>
        item.organisationId === organisationId &&
        referencedEvidence.has(item.id.toLowerCase()) &&
        item.relatedRoomId === task.roomId &&
        item.retentionState === "active" &&
        item.scanState !== "failed" &&
        item.scanState !== "uploading",
    )
    .slice(0, AGENT_HANDOFF_MAX_ARTIFACTS)
    .map((item) => ({
      id: item.id,
      label: safeText(item.fileName, 120) ?? `Evidence ${item.id.slice(0, 8)}`,
      mimeType: safeText(item.mimeType, 120) ?? "application/octet-stream",
      href: `/api/v1/evidence/${encodeURIComponent(item.id)}`,
    }));

  const verification = events
    .filter(
      (event) =>
        event.organisationId === organisationId &&
        event.runId === run.id &&
        verificationEventTypes.has(event.eventType),
    )
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .map((event) => safeText(event.message, 240))
    .find((message): message is string => Boolean(message));
  const verificationSummary = verification
    ? `Persisted verification: ${verification}`
    : artifacts.length > 0
      ? `${artifacts.length} authorised evidence ${artifacts.length === 1 ? "item is" : "items are"} persisted; no verification result was recorded.`
      : "No persisted verification evidence was recorded.";

  return {
    taskId: task.id,
    runId: run.id,
    roomId: task.roomId,
    disposition,
    outcome,
    requestedOutcome,
    verificationSummary,
    blocker:
      disposition === "blocked"
        ? (blocker ?? safeError ?? "No specific blocker detail was recorded.")
        : null,
    completedAt: run.completedAt.toISOString(),
    artifacts,
  };
}

export async function listAgentHandoffs(
  organisationId: string,
  options: {
    taskIds?: string[];
    roomId?: string;
    includeEvidence?: boolean;
    limit?: number;
  } = {},
): Promise<AgentHandoff[]> {
  if (options.taskIds?.length === 0) return [];
  const db = database();
  const taskConditions = [
    eq(schema.tasks.organisationId, organisationId),
    isNotNull(schema.tasks.agentRunId),
    inArray(schema.tasks.agentRunStatus, [...terminalStatuses]),
  ];
  if (options.taskIds) {
    taskConditions.push(inArray(schema.tasks.id, options.taskIds));
  }
  if (options.roomId) {
    taskConditions.push(eq(schema.tasks.roomId, options.roomId));
  }
  let taskQuery = db
    .select({
      id: schema.tasks.id,
      organisationId: schema.tasks.organisationId,
      title: schema.tasks.title,
      description: schema.tasks.description,
      roomId: schema.tasks.roomId,
      agentRunId: schema.tasks.agentRunId,
      agentRunStatus: schema.tasks.agentRunStatus,
    })
    .from(schema.tasks)
    .where(and(...taskConditions))
    .orderBy(desc(schema.tasks.updatedAt));
  const tasks = options.limit
    ? await taskQuery.limit(options.limit)
    : await taskQuery;
  const runIds = tasks
    .map((task) => task.agentRunId)
    .filter((id): id is string => Boolean(id));
  if (runIds.length === 0) return [];

  const runs = await db
    .select({
      id: schema.agentRuns.id,
      organisationId: schema.agentRuns.organisationId,
      roomId: schema.agentRuns.roomId,
      status: schema.agentRuns.status,
      request: schema.agentRuns.request,
      structuredOutput: schema.agentRuns.structuredOutput,
      failureCode: schema.agentRuns.failureCode,
      error: schema.agentRuns.error,
      cancellationReason: schema.agentRuns.cancellationReason,
      startedAt: schema.agentRuns.startedAt,
      completedAt: schema.agentRuns.completedAt,
    })
    .from(schema.agentRuns)
    .where(
      and(
        eq(schema.agentRuns.organisationId, organisationId),
        inArray(schema.agentRuns.id, runIds),
      ),
    );
  const events = await db
    .select({
      organisationId: schema.agentRunEvents.organisationId,
      runId: schema.agentRunEvents.runId,
      eventType: schema.agentRunEvents.eventType,
      message: schema.agentRunEvents.message,
      createdAt: schema.agentRunEvents.createdAt,
    })
    .from(schema.agentRunEvents)
    .where(
      and(
        eq(schema.agentRunEvents.organisationId, organisationId),
        inArray(schema.agentRunEvents.runId, runIds),
        inArray(schema.agentRunEvents.eventType, [...verificationEventTypes]),
      ),
    )
    .orderBy(desc(schema.agentRunEvents.createdAt))
    .limit(Math.min(runIds.length * 10, 500));

  const evidenceIds = new Set(
    runs.flatMap((run) => collectEvidenceIds(run.structuredOutput)),
  );
  const evidence =
    options.includeEvidence !== false && evidenceIds.size > 0
      ? await db
          .select({
            id: schema.evidence.id,
            organisationId: schema.evidence.organisationId,
            relatedRoomId: schema.evidence.relatedRoomId,
            fileName: schema.evidence.fileName,
            mimeType: schema.evidence.mimeType,
            scanState: schema.evidence.scanState,
            retentionState: schema.evidence.retentionState,
          })
          .from(schema.evidence)
          .where(
            and(
              eq(schema.evidence.organisationId, organisationId),
              inArray(schema.evidence.id, [...evidenceIds]),
            ),
          )
      : [];
  const runById = new Map(runs.map((run) => [run.id, run]));

  return tasks.flatMap((task) => {
    const run = task.agentRunId ? runById.get(task.agentRunId) : undefined;
    if (!run) return [];
    const handoff = buildAgentHandoff(
      organisationId,
      task,
      run,
      events,
      evidence,
    );
    return handoff ? [handoff] : [];
  });
}
