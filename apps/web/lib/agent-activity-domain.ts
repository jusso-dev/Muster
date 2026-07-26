import { and, desc, eq, inArray } from "drizzle-orm";
import { redactObservationText, TRUNCATION_MARKER } from "@muster/config";
import { database, schema } from "@muster/database";

export const AGENT_ACTIVITY_HEADLINE_MAX = 140;
export const AGENT_ACTIVITY_HEARTBEAT_FRESHNESS_MS = 120_000;

const setupEventTypes = new Set(["queued", "started", "recovered"]);

export type RoomAgentActivityRun = {
  id: string;
  organisationId: string;
  roomId: string | null;
  agentId: string;
  agentName: string;
  agentAvatar: string | null;
  definitionStatus: string;
  killSwitch: boolean;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  heartbeatAt: Date | null;
  deadlineAt: Date | null;
  maximumRuntimeSeconds: number;
};

export type AgentActivityEvent = {
  runId: string;
  eventType: string;
  message: string;
  createdAt: Date;
};

export type RoomAgentActivityCard = {
  agentId: string;
  agentName: string;
  agentAvatar: string | null;
  runId: string;
  status: "queued" | "running";
  headline: string;
  activityAt: string | null;
  activeSince: string;
  lastCompletedAt: string | null;
};

function activityTime(run: RoomAgentActivityRun): number {
  return (
    run.heartbeatAt?.getTime() ??
    run.startedAt?.getTime() ??
    (run.deadlineAt
      ? run.deadlineAt.getTime() - run.maximumRuntimeSeconds * 1_000
      : 0)
  );
}

export function selectActiveRoomAgentRuns(
  runs: RoomAgentActivityRun[],
  scope: { organisationId: string; roomId: string },
  now = new Date(),
): RoomAgentActivityRun[] {
  const heartbeatCutoff =
    now.getTime() - AGENT_ACTIVITY_HEARTBEAT_FRESHNESS_MS;
  const active = runs
    .filter((run) => {
      if (
        run.organisationId !== scope.organisationId ||
        run.roomId !== scope.roomId ||
        run.definitionStatus !== "active" ||
        run.killSwitch ||
        !run.deadlineAt ||
        run.deadlineAt.getTime() <= now.getTime()
      ) {
        return false;
      }
      if (run.status === "queued") return true;
      return (
        run.status === "running" &&
        Boolean(
          run.heartbeatAt && run.heartbeatAt.getTime() >= heartbeatCutoff,
        )
      );
    })
    .sort((left, right) => activityTime(right) - activityTime(left));

  const latestByAgent = new Map<string, RoomAgentActivityRun>();
  for (const run of active) {
    if (!latestByAgent.has(run.agentId)) latestByAgent.set(run.agentId, run);
  }
  return [...latestByAgent.values()];
}

export function safeActivityHeadline(events: AgentActivityEvent[]): {
  headline: string;
  activityAt: string | null;
} {
  const event = [...events]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .find((candidate) => !setupEventTypes.has(candidate.eventType));
  if (!event) {
    return { headline: "Working in this room", activityAt: null };
  }
  const redactionLimit =
    AGENT_ACTIVITY_HEADLINE_MAX - TRUNCATION_MARKER.length;
  const headline = redactObservationText(event.message, {
    maxStringLength: redactionLimit,
  })
    .replace(/\s+/g, " ")
    .trim();
  return {
    headline: headline || "Activity update unavailable",
    activityAt: event.createdAt.toISOString(),
  };
}

export function latestCompletionByAgent(
  runs: RoomAgentActivityRun[],
  scope: { organisationId: string; roomId: string },
): Map<string, Date> {
  const latest = new Map<string, Date>();
  for (const run of runs) {
    if (
      run.organisationId !== scope.organisationId ||
      run.roomId !== scope.roomId ||
      run.status !== "completed" ||
      !run.completedAt
    ) {
      continue;
    }
    const current = latest.get(run.agentId);
    if (!current || current < run.completedAt) {
      latest.set(run.agentId, run.completedAt);
    }
  }
  return latest;
}

export async function listRoomAgentActivity(
  organisationId: string,
  roomId: string,
  now = new Date(),
) {
  const db = database();
  const [roomRows, activeCandidates] = await Promise.all([
    db
      .select({
        id: schema.rooms.id,
        displayName: schema.rooms.displayName,
      })
      .from(schema.rooms)
      .where(
        and(
          eq(schema.rooms.id, roomId),
          eq(schema.rooms.organisationId, organisationId),
        ),
      )
      .limit(1),
    db
      .select({
        id: schema.agentRuns.id,
        organisationId: schema.agentRuns.organisationId,
        roomId: schema.agentRuns.roomId,
        agentId: schema.agentRuns.agentId,
        agentName: schema.agentDefinitions.name,
        agentAvatar: schema.agentDefinitions.avatar,
        definitionStatus: schema.agentDefinitions.status,
        killSwitch: schema.agentDefinitions.killSwitch,
        status: schema.agentRuns.status,
        startedAt: schema.agentRuns.startedAt,
        completedAt: schema.agentRuns.completedAt,
        heartbeatAt: schema.agentRuns.heartbeatAt,
        deadlineAt: schema.agentRuns.deadlineAt,
        maximumRuntimeSeconds: schema.agentRuns.maximumRuntimeSeconds,
      })
      .from(schema.agentRuns)
      .innerJoin(
        schema.agentDefinitions,
        eq(schema.agentDefinitions.id, schema.agentRuns.agentId),
      )
      .where(
        and(
          eq(schema.agentRuns.organisationId, organisationId),
          eq(schema.agentRuns.roomId, roomId),
          inArray(schema.agentRuns.status, ["queued", "running"]),
        ),
      )
      .orderBy(
        desc(schema.agentRuns.heartbeatAt),
        desc(schema.agentRuns.deadlineAt),
      )
      .limit(50),
  ]);
  const room = roomRows[0];
  if (!room) throw new Error("Room not found");

  const activeRuns = selectActiveRoomAgentRuns(
    activeCandidates,
    { organisationId, roomId },
    now,
  );
  if (activeRuns.length === 0) {
    return { roomId, roomName: room.displayName, activeAgents: [] };
  }

  const runIds = activeRuns.map((run) => run.id);
  const agentIds = activeRuns.map((run) => run.agentId);
  const [events, completedRuns] = await Promise.all([
    db
      .select({
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
        ),
      )
      .orderBy(desc(schema.agentRunEvents.createdAt))
      .limit(500),
    db
      .select({
        id: schema.agentRuns.id,
        organisationId: schema.agentRuns.organisationId,
        roomId: schema.agentRuns.roomId,
        agentId: schema.agentRuns.agentId,
        agentName: schema.agentDefinitions.name,
        agentAvatar: schema.agentDefinitions.avatar,
        definitionStatus: schema.agentDefinitions.status,
        killSwitch: schema.agentDefinitions.killSwitch,
        status: schema.agentRuns.status,
        startedAt: schema.agentRuns.startedAt,
        completedAt: schema.agentRuns.completedAt,
        heartbeatAt: schema.agentRuns.heartbeatAt,
        deadlineAt: schema.agentRuns.deadlineAt,
        maximumRuntimeSeconds: schema.agentRuns.maximumRuntimeSeconds,
      })
      .from(schema.agentRuns)
      .innerJoin(
        schema.agentDefinitions,
        eq(schema.agentDefinitions.id, schema.agentRuns.agentId),
      )
      .where(
        and(
          eq(schema.agentRuns.organisationId, organisationId),
          eq(schema.agentRuns.roomId, roomId),
          eq(schema.agentRuns.status, "completed"),
          inArray(schema.agentRuns.agentId, agentIds),
        ),
      )
      .orderBy(desc(schema.agentRuns.completedAt))
      .limit(100),
  ]);

  const eventsByRun = new Map<string, AgentActivityEvent[]>();
  for (const event of events) {
    const current = eventsByRun.get(event.runId) ?? [];
    current.push(event);
    eventsByRun.set(event.runId, current);
  }
  const completions = latestCompletionByAgent(completedRuns, {
    organisationId,
    roomId,
  });

  const activeAgents: RoomAgentActivityCard[] = activeRuns.map((run) => {
    const activity = safeActivityHeadline(eventsByRun.get(run.id) ?? []);
    const activeSince =
      run.startedAt ??
      new Date(
        run.deadlineAt!.getTime() - run.maximumRuntimeSeconds * 1_000,
      );
    return {
      agentId: run.agentId,
      agentName: run.agentName,
      agentAvatar: run.agentAvatar,
      runId: run.id,
      status: run.status as "queued" | "running",
      headline: activity.headline,
      activityAt: activity.activityAt,
      activeSince: activeSince.toISOString(),
      lastCompletedAt: completions.get(run.agentId)?.toISOString() ?? null,
    };
  });

  return { roomId, roomName: room.displayName, activeAgents };
}
