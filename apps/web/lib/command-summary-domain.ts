import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import {
  hasCapability,
  type AuthorisationSubject,
} from "@muster/authz";
import { database, schema } from "@muster/database";
import { getControlPlaneStatus } from "./control-plane-status.ts";
import { relativeTime } from "./utils.ts";
import type {
  ActivityEvent,
  AgentActivityRow,
  AttentionItem,
  CommandMetric,
  IntegrationHealthChip,
  MetricTrend,
  MyTaskRow,
  RiskRadarCell,
  RunActivityPoint,
  TaskStatusSlice,
} from "@/types/os";
import { toHealthState, toOperationalState } from "@/types/status";

export type CommandSummary = {
  generatedAt: string;
  metrics: CommandMetric[];
  attention: AttentionItem[];
  riskRadar: RiskRadarCell[];
  activity: ActivityEvent[];
  /** Live status distribution of every non-archived work item. */
  taskStatus: TaskStatusSlice[];
  /** Agent runs bucketed by hour over the last 24 hours. */
  runActivity: RunActivityPoint[];
  /** Per-agent run volume and success rate over the last 7 days. */
  agentActivity: AgentActivityRow[];
  /** Open work items the session's actor owns, plus the unassigned queue. */
  myTasks: MyTaskRow[];
  /** Control-plane components, one chip each. */
  integrations: IntegrationHealthChip[];
  agents: Array<{
    id: string;
    name: string;
    status: string;
    killSwitch: boolean;
    runtime: string;
    lastRunStatus: string | null;
    lastRunAt: string | null;
    slackExposed: boolean;
  }>;
  overallHealth: string;
  pendingApprovalCount: number;
  partial: boolean;
  notes: string[];
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TREND_WINDOW_DAYS = 7;

/** Oldest → newest daily counts, so a sparkline reads left to right. */
function dailySeries(timestamps: Date[], now: number): number[] {
  const buckets = new Array<number>(TREND_WINDOW_DAYS).fill(0);
  for (const at of timestamps) {
    const age = now - at.getTime();
    if (age < 0 || age >= TREND_WINDOW_DAYS * DAY_MS) continue;
    const index = TREND_WINDOW_DAYS - 1 - Math.floor(age / DAY_MS);
    buckets[index] = (buckets[index] ?? 0) + 1;
  }
  return buckets;
}

/**
 * Compares the last 24 hours with the 24 before it. Returns undefined when
 * both windows are empty — an arrow drawn over no events is decoration.
 */
function dayOverDayTrend(
  timestamps: Date[],
  now: number,
  label: string,
  improving: MetricTrend["improving"],
): MetricTrend | undefined {
  let current = 0;
  let previous = 0;
  for (const at of timestamps) {
    const age = now - at.getTime();
    if (age < 0) continue;
    if (age < DAY_MS) current += 1;
    else if (age < 2 * DAY_MS) previous += 1;
  }
  if (current === 0 && previous === 0) return undefined;
  const delta = current - previous;
  return {
    delta,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    label,
    improving,
  };
}

/** Optional-property spread so an absent trend stays absent, not undefined. */
function trendField(trend: MetricTrend | undefined) {
  return trend ? { trend } : {};
}

const TASK_STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

const TASK_PRIORITY_SEVERITY = {
  urgent: "critical",
  high: "high",
  normal: "medium",
  low: "low",
} as const;

const OPEN_TASK_STATUSES = ["backlog", "ready", "in_progress", "review"] as const;

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

type AgentRunRow = {
  agentId: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
};

type AgentRunTally = {
  runs: number;
  succeeded: number;
  settled: number;
  lastRunAt: Date | null;
};

type QueueTaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignedActorId: string | null;
  dueAt: Date | null;
  updatedAt: Date;
};

type AgentPanelRow = {
  id: string;
  name: string;
  status: string;
  killSwitch: boolean;
  runtime: string;
  lastRun: {
    status: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
};

/** 24 hourly buckets ending with the hour in progress. */
function buildRunActivity(
  now: number,
  recentAgentRuns: AgentRunRow[],
): { runActivity: RunActivityPoint[]; runsByAgent: Map<string, AgentRunTally> } {
  const firstBucket = Math.floor(now / HOUR_MS) * HOUR_MS - 23 * HOUR_MS;
  const runActivity: RunActivityPoint[] = Array.from({ length: 24 }, (_, i) => {
    const start = new Date(firstBucket + i * HOUR_MS);
    return {
      bucket: start.toISOString(),
      completed: 0,
      failed: 0,
      running: 0,
      cancelled: 0,
    };
  });

  const runsByAgent = new Map<string, AgentRunTally>();

  for (const run of recentAgentRuns) {
    const startedAt = run.startedAt;
    if (!startedAt) continue;
    const state = toOperationalState(run.status);

    const index = Math.floor((startedAt.getTime() - firstBucket) / HOUR_MS);
    const point = index >= 0 && index < 24 ? runActivity[index] : undefined;
    if (point) {
      if (state === "completed") point.completed += 1;
      else if (state === "failed") point.failed += 1;
      else if (state === "cancelled") point.cancelled += 1;
      else point.running += 1;
    }

    const tally = runsByAgent.get(run.agentId) ?? {
      runs: 0,
      succeeded: 0,
      settled: 0,
      lastRunAt: null,
    };
    tally.runs += 1;
    if (state === "completed") {
      tally.succeeded += 1;
      tally.settled += 1;
    } else if (state === "failed") {
      tally.settled += 1;
    }
    const seenAt = run.completedAt ?? startedAt;
    if (!tally.lastRunAt || seenAt > tally.lastRunAt) tally.lastRunAt = seenAt;
    runsByAgent.set(run.agentId, tally);
  }

  return { runActivity, runsByAgent };
}

function buildAgentActivity(
  agentRows: AgentPanelRow[],
  runsByAgent: Map<string, AgentRunTally>,
): AgentActivityRow[] {
  return agentRows
    .map((agent) => {
      const tally = runsByAgent.get(agent.id);
      return {
        id: agent.id,
        name: agent.name,
        status: agent.killSwitch ? "isolated" : agent.status,
        runtime: agent.runtime,
        runs: tally?.runs ?? 0,
        succeeded: tally?.succeeded ?? 0,
        // A rate over zero settled runs would be an invented 100%.
        successRate:
          tally && tally.settled > 0 ? tally.succeeded / tally.settled : null,
        lastRunAt:
          tally?.lastRunAt?.toISOString() ??
          agent.lastRun?.completedAt ??
          agent.lastRun?.startedAt ??
          null,
      };
    })
    .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))
    .slice(0, 6);
}

function buildMyTasks(
  queueTasks: QueueTaskRow[],
  actorId: string,
): MyTaskRow[] {
  return queueTasks
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    )
    .slice(0, 20)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: toOperationalState(task.status),
      rawStatus: task.status,
      priority: task.priority,
      severity:
        TASK_PRIORITY_SEVERITY[
          task.priority as keyof typeof TASK_PRIORITY_SEVERITY
        ] ?? "medium",
      sourceSystem: "Muster",
      updatedAt: task.updatedAt.toISOString(),
      dueAt: task.dueAt?.toISOString() ?? null,
      assignedToMe: task.assignedActorId === actorId,
    }));
}

function buildIntegrations(
  controlPlane: Awaited<ReturnType<typeof getControlPlaneStatus>> | null,
): IntegrationHealthChip[] {
  if (!controlPlane) return [];
  return [
    {
      id: "kelpie",
      name: controlPlane.kelpie.displayName ?? "Kelpie",
      health: toHealthState(controlPlane.kelpie.status),
      detail: controlPlane.kelpie.lastSyncAt
        ? `Synced ${relativeTime(controlPlane.kelpie.lastSyncAt)}`
        : "No sync recorded",
    },
    {
      id: "slack",
      name: "Slack",
      health: toHealthState(controlPlane.slack.status),
      detail: `Workspace ${controlPlane.slack.status}`,
    },
    {
      id: "mcp",
      name: "MCP",
      health: toHealthState(controlPlane.mcp.status),
      detail: `${controlPlane.mcp.activeInstallations} active installation${
        controlPlane.mcp.activeInstallations === 1 ? "" : "s"
      }`,
    },
    {
      id: "codex",
      name: "Codex runtime",
      health: toHealthState(controlPlane.codex.status),
      detail:
        controlPlane.codex.detail ??
        controlPlane.codex.runtime ??
        `Runtime ${controlPlane.codex.status}`,
    },
  ];
}

export async function getCommandSummary(
  subject: AuthorisationSubject,
): Promise<CommandSummary> {
  const db = database();
  const notes: string[] = [];
  const canAdmin = hasCapability(subject, "administration.manage");
  const canApprove = hasCapability(subject, "workflows.approve");
  const canReadWorkflows = hasCapability(subject, "workflows.read");
  const canReadAgents = hasCapability(subject, "agents.read");
  const canReadTasks = hasCapability(subject, "tasks.read");

  let controlPlane: Awaited<ReturnType<typeof getControlPlaneStatus>> | null =
    null;
  if (canAdmin) {
    try {
      controlPlane = await getControlPlaneStatus(subject);
    } catch {
      notes.push("Control-plane status unavailable for this session.");
    }
  } else {
    notes.push("Control-plane metrics require administration.manage.");
  }

  const pendingApprovals = canApprove
    ? await db
        .select({
          id: schema.approvals.id,
          actionType: schema.approvals.actionType,
          riskSummary: schema.approvals.riskSummary,
          status: schema.approvals.status,
          requestedAt: schema.approvals.requestedAt,
          requiredCapability: schema.approvals.requiredCapability,
        })
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.organisationId, subject.organisationId),
            eq(schema.approvals.status, "pending"),
            // An overdue row is still stored as pending until something reads
            // the inbox and expires it. Never count it as actionable here.
            gt(schema.approvals.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(schema.approvals.requestedAt))
        .limit(25)
    : [];

  const activeMissions = canReadWorkflows
    ? await db
        .select({
          id: schema.governedMissions.id,
          name: schema.governedMissions.name,
          status: schema.governedMissions.status,
          killSwitch: schema.governedMissions.killSwitch,
          updatedAt: schema.governedMissions.updatedAt,
        })
        .from(schema.governedMissions)
        .where(
          and(
            eq(schema.governedMissions.organisationId, subject.organisationId),
            inArray(schema.governedMissions.status, ["active", "paused"]),
          ),
        )
        .orderBy(desc(schema.governedMissions.updatedAt))
        .limit(50)
    : [];

  const failedRuns = canReadWorkflows
    ? await db
        .select({
          id: schema.governedMissionRuns.id,
          missionId: schema.governedMissionRuns.missionId,
          status: schema.governedMissionRuns.status,
          error: schema.governedMissionRuns.error,
          createdAt: schema.governedMissionRuns.createdAt,
        })
        .from(schema.governedMissionRuns)
        .where(
          and(
            eq(
              schema.governedMissionRuns.organisationId,
              subject.organisationId,
            ),
            eq(schema.governedMissionRuns.status, "failed"),
          ),
        )
        .orderBy(desc(schema.governedMissionRuns.createdAt))
        .limit(10)
    : [];

  const openTasks = canReadTasks
    ? await db
        .select({
          id: schema.tasks.id,
          title: schema.tasks.title,
          status: schema.tasks.status,
          priority: schema.tasks.priority,
          assignedActorId: schema.tasks.assignedActorId,
          dueAt: schema.tasks.dueAt,
          createdAt: schema.tasks.createdAt,
          updatedAt: schema.tasks.updatedAt,
        })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.organisationId, subject.organisationId),
            isNull(schema.tasks.archivedAt),
            inArray(schema.tasks.status, [...OPEN_TASK_STATUSES]),
          ),
        )
        .orderBy(desc(schema.tasks.updatedAt))
        .limit(50)
    : [];

  // Dedicated queue source: mine + unassigned open tasks, not filtered from the
  // attention-capped openTasks list (which can omit eligible rows past 50).
  const queueTasks = canReadTasks
    ? await db
        .select({
          id: schema.tasks.id,
          title: schema.tasks.title,
          status: schema.tasks.status,
          priority: schema.tasks.priority,
          assignedActorId: schema.tasks.assignedActorId,
          dueAt: schema.tasks.dueAt,
          updatedAt: schema.tasks.updatedAt,
        })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.organisationId, subject.organisationId),
            isNull(schema.tasks.archivedAt),
            inArray(schema.tasks.status, [...OPEN_TASK_STATUSES]),
            or(
              eq(schema.tasks.assignedActorId, subject.actorId),
              isNull(schema.tasks.assignedActorId),
            ),
          ),
        )
        .orderBy(desc(schema.tasks.updatedAt))
    : [];

  const now = Date.now();
  const windowStart = new Date(now - TREND_WINDOW_DAYS * DAY_MS);

  // Independent reads — run concurrently on the request path.
  // recentTasks/recentApprovals: desc + limit keeps the newest 2k rows so the
  // series reflects recent activity (truncation drops the oldest).
  const [
    taskStatusCounts,
    recentTasks,
    recentApprovals,
    recentMissionRuns,
    recentAgentRuns,
  ] = await Promise.all([
    canReadTasks
      ? db
          .select({ status: schema.tasks.status, total: count() })
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.organisationId, subject.organisationId),
              isNull(schema.tasks.archivedAt),
            ),
          )
          .groupBy(schema.tasks.status)
      : Promise.resolve(
          [] as Array<{ status: string; total: number | string }>,
        ),
    canReadTasks
      ? db
          .select({ createdAt: schema.tasks.createdAt })
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.organisationId, subject.organisationId),
              isNull(schema.tasks.archivedAt),
              gte(schema.tasks.createdAt, windowStart),
            ),
          )
          .orderBy(desc(schema.tasks.createdAt))
          .limit(2_000)
      : Promise.resolve([] as Array<{ createdAt: Date | null }>),
    canApprove
      ? db
          .select({ requestedAt: schema.approvals.requestedAt })
          .from(schema.approvals)
          .where(
            and(
              eq(schema.approvals.organisationId, subject.organisationId),
              gte(schema.approvals.requestedAt, windowStart),
            ),
          )
          .orderBy(desc(schema.approvals.requestedAt))
          .limit(2_000)
      : Promise.resolve([] as Array<{ requestedAt: Date | null }>),
    canReadWorkflows
      ? db
          .select({
            status: schema.governedMissionRuns.status,
            createdAt: schema.governedMissionRuns.createdAt,
          })
          .from(schema.governedMissionRuns)
          .where(
            and(
              eq(
                schema.governedMissionRuns.organisationId,
                subject.organisationId,
              ),
              gte(schema.governedMissionRuns.createdAt, windowStart),
            ),
          )
          .limit(2_000)
      : Promise.resolve(
          [] as Array<{ status: string; createdAt: Date | null }>,
        ),
    canReadAgents || canAdmin
      ? db
          .select({
            agentId: schema.agentRuns.agentId,
            status: schema.agentRuns.status,
            startedAt: schema.agentRuns.startedAt,
            completedAt: schema.agentRuns.completedAt,
          })
          .from(schema.agentRuns)
          .where(
            and(
              eq(schema.agentRuns.organisationId, subject.organisationId),
              gte(schema.agentRuns.startedAt, windowStart),
            ),
          )
          .orderBy(desc(schema.agentRuns.startedAt))
          .limit(5_000)
      : Promise.resolve([] as AgentRunRow[]),
  ]);

  // Blocked and approval-stalled pack handoffs are operational debt: an agent
  // asked for help and nothing is moving. Surface them, do not bury them.
  const stalledHandoffs = canReadAgents
    ? await db
        .select({
          id: schema.packHandoffs.id,
          status: schema.packHandoffs.status,
          reason: schema.packHandoffs.reason,
          blockedReason: schema.packHandoffs.blockedReason,
          taskId: schema.packHandoffs.taskId,
          fromAgentActorId: schema.packHandoffs.fromAgentActorId,
          toAgentActorId: schema.packHandoffs.toAgentActorId,
          createdAt: schema.packHandoffs.createdAt,
        })
        .from(schema.packHandoffs)
        .where(
          and(
            eq(schema.packHandoffs.organisationId, subject.organisationId),
            inArray(schema.packHandoffs.status, ["blocked", "awaiting_approval"]),
          ),
        )
        .orderBy(desc(schema.packHandoffs.updatedAt))
        .limit(25)
    : [];

  const recentAudit = canAdmin
    ? await db
        .select({
          id: schema.auditEvents.id,
          action: schema.auditEvents.action,
          targetType: schema.auditEvents.targetType,
          targetId: schema.auditEvents.targetId,
          actorId: schema.auditEvents.actorId,
          actorName: schema.actors.displayName,
          createdAt: schema.auditEvents.createdAt,
        })
        .from(schema.auditEvents)
        .leftJoin(
          schema.actors,
          and(
            eq(schema.actors.id, schema.auditEvents.actorId),
            eq(schema.actors.organisationId, schema.auditEvents.organisationId),
          ),
        )
        .where(eq(schema.auditEvents.organisationId, subject.organisationId))
        .orderBy(desc(schema.auditEvents.sequence))
        .limit(20)
    : [];

  type AgentRow = {
    id: string;
    name: string;
    status: string;
    killSwitch: boolean;
    runtime: string;
    systemPromptVersion: string;
    slackExposed: boolean;
    slackDefault: boolean;
    lastRun: {
      id: string;
      status: string;
      startedAt: string | null;
      completedAt: string | null;
    } | null;
  };

  let agentRows: AgentRow[] = [];
  if (controlPlane?.agents) {
    agentRows = controlPlane.agents;
  } else if (canReadAgents || canAdmin) {
    const defs = await db
      .select({
        id: schema.agentDefinitions.id,
        name: schema.agentDefinitions.name,
        status: schema.agentDefinitions.status,
        killSwitch: schema.agentDefinitions.killSwitch,
        runtime: schema.agentDefinitions.runtime,
      })
      .from(schema.agentDefinitions)
      .where(eq(schema.agentDefinitions.organisationId, subject.organisationId))
      .limit(20);
    const runRows = await db
      .select({
        id: schema.agentRuns.id,
        agentId: schema.agentRuns.agentId,
        status: schema.agentRuns.status,
        startedAt: schema.agentRuns.startedAt,
        completedAt: schema.agentRuns.completedAt,
      })
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.organisationId, subject.organisationId))
      .orderBy(desc(schema.agentRuns.startedAt))
      .limit(100);
    const lastByAgent = new Map<string, (typeof runRows)[number]>();
    for (const run of runRows) {
      if (!lastByAgent.has(run.agentId)) lastByAgent.set(run.agentId, run);
    }
    agentRows = defs.map((agent) => {
      const last = lastByAgent.get(agent.id);
      return {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        killSwitch: agent.killSwitch,
        runtime: agent.runtime,
        systemPromptVersion: "",
        slackExposed: false,
        slackDefault: false,
        lastRun: last
          ? {
              id: last.id,
              status: last.status,
              startedAt: last.startedAt?.toISOString() ?? null,
              completedAt: last.completedAt?.toISOString() ?? null,
            }
          : null,
      };
    });
  }

  const failedAgentRuns = agentRows.filter(
    (a) => a.lastRun?.status === "failed",
  ).length;

  const blockedTasks = openTasks.filter(
    (t) => t.status === "review" || t.priority === "urgent",
  ).length;
  const highPriorityTasks = openTasks.filter(
    (t) => t.priority === "high" || t.priority === "urgent",
  ).length;

  const degradedIntegrations = controlPlane
    ? [
        controlPlane.kelpie.status,
        controlPlane.slack.status,
        controlPlane.mcp.status,
        controlPlane.codex.status,
      ].filter((s) => s === "degraded" || s === "unavailable").length
    : 0;

  const taskCreatedAt = recentTasks
    .map((row) => row.createdAt)
    .filter((at): at is Date => at instanceof Date);
  const approvalRequestedAt = recentApprovals
    .map((row) => row.requestedAt)
    .filter((at): at is Date => at instanceof Date);
  const failedMissionRunAt = recentMissionRuns
    .filter((row) => row.status === "failed")
    .map((row) => row.createdAt)
    .filter((at): at is Date => at instanceof Date);
  const failedAgentRunAt = recentAgentRuns
    .filter((row) => toOperationalState(row.status) === "failed")
    .map((row) => row.completedAt ?? row.startedAt)
    .filter((at): at is Date => at instanceof Date);
  // Tiles state a window, not "ever": a count and the series under it have to
  // be measuring the same thing or the tile contradicts itself.
  const failedAgentRuns24h = failedAgentRunAt.filter(
    (at) => now - at.getTime() < DAY_MS,
  ).length;
  const failedMissionRuns7d = failedMissionRunAt.length;

  const statusOrder = ["backlog", "ready", "in_progress", "review", "done"];
  const taskStatus: TaskStatusSlice[] = taskStatusCounts
    .map((row) => ({
      status: row.status,
      label: TASK_STATUS_LABELS[row.status] ?? row.status,
      count: Number(row.total),
    }))
    .sort(
      (a, b) =>
        (statusOrder.indexOf(a.status) + 1 || 99) -
        (statusOrder.indexOf(b.status) + 1 || 99),
    );

  const { runActivity, runsByAgent } = buildRunActivity(now, recentAgentRuns);
  const agentActivity = buildAgentActivity(agentRows, runsByAgent);
  const myTasks = buildMyTasks(queueTasks, subject.actorId);
  const integrations = buildIntegrations(controlPlane);

  const metrics: CommandMetric[] = [
    {
      id: "pending-approvals",
      label: "Pending approvals",
      value: pendingApprovals.length,
      tone: pendingApprovals.length > 0 ? "warning" : "default",
      href: "/approvals",
      ...(canApprove ? {} : { hint: "Requires workflows.approve" }),
      ...(canApprove
        ? {
            series: dailySeries(approvalRequestedAt, now),
            seriesLabel: "Approvals requested per day, last 7 days",
          }
        : {}),
      ...trendField(
        dayOverDayTrend(
          approvalRequestedAt,
          now,
          "requested vs previous 24h",
          "down",
        ),
      ),
    },
    {
      id: "high-priority",
      label: "High-priority work",
      value: highPriorityTasks,
      tone: highPriorityTasks > 0 ? "danger" : "default",
      href: "/operations",
    },
    {
      id: "blocked",
      label: "Blocked work",
      value: blockedTasks,
      tone: blockedTasks > 0 ? "warning" : "default",
      href: "/operations",
    },
    {
      id: "active-missions",
      label: "Active missions",
      value: activeMissions.filter((m) => m.status === "active").length,
      href: "/missions",
    },
    {
      id: "degraded-integrations",
      label: "Degraded integrations",
      value: degradedIntegrations,
      tone: degradedIntegrations > 0 ? "danger" : "success",
      href: "/integrations",
    },
    {
      id: "failed-agent-runs",
      label: "Failed agent runs (24h)",
      value: failedAgentRuns24h,
      tone: failedAgentRuns24h > 0 ? "danger" : "default",
      href: "/agents",
      series: dailySeries(failedAgentRunAt, now),
      seriesLabel: "Failed agent runs per day, last 7 days",
      ...trendField(
        dayOverDayTrend(failedAgentRunAt, now, "failures vs previous 24h", "down"),
      ),
    },
    {
      id: "failed-missions",
      label: "Failed mission runs (7d)",
      value: failedMissionRuns7d,
      tone: failedMissionRuns7d > 0 ? "danger" : "default",
      href: "/missions",
      series: dailySeries(failedMissionRunAt, now),
      seriesLabel: "Failed mission runs per day, last 7 days",
      ...trendField(
        dayOverDayTrend(
          failedMissionRunAt,
          now,
          "failures vs previous 24h",
          "down",
        ),
      ),
    },
    {
      id: "blocked-handoffs",
      label: "Stalled pack handoffs",
      value: stalledHandoffs.length,
      tone: stalledHandoffs.length > 0 ? "warning" : "default",
      href: "/operations",
      ...(canReadAgents ? {} : { hint: "Requires agents.read" }),
    },
    {
      id: "open-tasks",
      label: "Open work items",
      value: openTasks.length,
      href: "/operations",
      ...(canReadTasks
        ? {
            series: dailySeries(taskCreatedAt, now),
            seriesLabel: "Work items opened per day, last 7 days",
          }
        : {}),
      ...trendField(
        dayOverDayTrend(taskCreatedAt, now, "opened vs previous 24h", "neutral"),
      ),
    },
  ];

  const attention: AttentionItem[] = [];
  for (const approval of pendingApprovals) {
    attention.push({
      id: `approval:${approval.id}`,
      title: approval.actionType,
      type: "pending_approval",
      severity: "high",
      owner: null,
      age: relativeTime(approval.requestedAt),
      sourceSystem: "Muster",
      recommendedAction: "Review and approve or reject",
      href: `/approvals?focus=${approval.id}`,
    });
  }
  for (const run of failedRuns) {
    attention.push({
      id: `mission-run:${run.id}`,
      title: run.error?.slice(0, 120) || "Mission run failed",
      type: "failed_mission",
      severity: "high",
      owner: null,
      age: relativeTime(run.createdAt),
      sourceSystem: "Muster missions",
      recommendedAction: "Inspect run and retry if safe",
      href: `/missions`,
    });
  }
  for (const agent of agentRows) {
    if (agent.killSwitch) {
      attention.push({
        id: `agent-kill:${agent.id}`,
        title: `${agent.name} kill switch engaged`,
        type: "agent_kill_switch",
        severity: "critical",
        owner: agent.name,
        age: "—",
        sourceSystem: "Muster agents",
        recommendedAction: "Confirm intentional isolation",
        href: `/agents/${agent.id}`,
      });
    } else if (agent.lastRun?.status === "failed") {
      attention.push({
        id: `agent-fail:${agent.id}`,
        title: `${agent.name} last run failed`,
        type: "failed_agent_invocation",
        severity: "medium",
        owner: agent.name,
        age: agent.lastRun.completedAt
          ? relativeTime(agent.lastRun.completedAt)
          : "—",
        sourceSystem: agent.runtime,
        recommendedAction: "Inspect agent readiness and last run",
        href: `/agents/${agent.id}`,
      });
    }
  }
  for (const handoff of stalledHandoffs) {
    const blocked = handoff.status === "blocked";
    attention.push({
      id: `pack-handoff:${handoff.id}`,
      title: blocked
        ? `Handoff blocked (${handoff.reason})`
        : `Handoff awaiting approval (${handoff.reason})`,
      type: blocked ? "blocked_pack_handoff" : "pending_pack_handoff",
      severity: blocked ? "high" : "medium",
      owner: null,
      age: relativeTime(handoff.createdAt),
      sourceSystem: "Muster pack",
      recommendedAction: blocked
        ? (handoff.blockedReason?.slice(0, 160) ??
          "Review the refused handoff route")
        : "Decide the approval before the handoff expires",
      href: handoff.taskId ? `/operations?task=${handoff.taskId}` : "/approvals",
    });
  }
  if (controlPlane) {
    for (const [name, status] of [
      ["Kelpie", controlPlane.kelpie.status],
      ["Slack", controlPlane.slack.status],
      ["MCP", controlPlane.mcp.status],
      ["Codex runtime", controlPlane.codex.status],
    ] as const) {
      if (status === "unavailable" || status === "degraded") {
        attention.push({
          id: `integration:${name}`,
          title: `${name} is ${status}`,
          type: "unhealthy_connector",
          severity: status === "unavailable" ? "critical" : "high",
          age: relativeTime(controlPlane.generatedAt),
          sourceSystem: name,
          recommendedAction: "Open Integrations and verify wiring",
          href: "/integrations",
        });
      }
    }
  }

  const riskRadar: RiskRadarCell[] = [
    {
      id: "incidents",
      label: "Incidents / work",
      summary: `${openTasks.length} open tasks`,
      health: blockedTasks > 0 ? "degraded" : openTasks.length > 20 ? "degraded" : "healthy",
      count: openTasks.length,
    },
    {
      id: "approvals",
      label: "Approvals",
      summary: `${pendingApprovals.length} pending`,
      health:
        pendingApprovals.length > 5
          ? "degraded"
          : pendingApprovals.length > 0
            ? "degraded"
            : "healthy",
      count: pendingApprovals.length,
    },
    {
      id: "agents",
      label: "Agent execution",
      summary: `${failedAgentRuns} failed last runs`,
      health:
        failedAgentRuns > 0
          ? "unhealthy"
          : agentRows.some((a) => a.killSwitch)
            ? "degraded"
            : "healthy",
      count: failedAgentRuns,
    },
    {
      id: "pack-handoffs",
      label: "Pack handoffs",
      summary: `${stalledHandoffs.length} stalled`,
      health: stalledHandoffs.length > 0 ? "degraded" : "healthy",
      count: stalledHandoffs.length,
    },
    {
      id: "missions",
      label: "Missions",
      summary: `${failedRuns.length} recent failures`,
      health: failedRuns.length > 0 ? "degraded" : "healthy",
      count: failedRuns.length,
    },
    {
      id: "integrations",
      label: "Integrations",
      summary: controlPlane
        ? `${degradedIntegrations} degraded`
        : "Not authorised",
      health: controlPlane
        ? toHealthState(
            degradedIntegrations > 0
              ? degradedIntegrations > 1
                ? "unavailable"
                : "degraded"
              : "ready",
          )
        : "unknown",
      count: degradedIntegrations,
    },
    {
      id: "telemetry",
      label: "Telemetry health",
      summary: controlPlane
        ? `Readiness ${controlPlane.readiness.status}`
        : "Unknown",
      health: controlPlane
        ? toHealthState(controlPlane.readiness.status)
        : "unknown",
    },
    {
      id: "coverage",
      label: "Detection coverage",
      summary: "No coverage score API yet",
      health: "unknown",
    },
    {
      id: "delivery",
      label: "Customer delivery",
      summary: "Customer portfolio not in foundation",
      health: "unknown",
    },
  ];

  const activity: ActivityEvent[] = recentAudit.map((row) => ({
    id: row.id,
    timestamp: row.createdAt.toISOString(),
    actor: row.actorName ?? row.actorId.slice(0, 8),
    action: row.action,
    target: `${row.targetType}:${row.targetId}`,
    href: "/audit",
  }));

  return {
    generatedAt: new Date().toISOString(),
    metrics,
    attention: attention.slice(0, 40),
    riskRadar,
    activity,
    taskStatus,
    runActivity,
    agentActivity,
    myTasks,
    integrations,
    agents: agentRows.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.killSwitch ? "isolated" : agent.status,
      killSwitch: agent.killSwitch,
      runtime: agent.runtime,
      lastRunStatus: agent.lastRun?.status ?? null,
      lastRunAt:
        agent.lastRun?.completedAt ?? agent.lastRun?.startedAt ?? null,
      slackExposed: agent.slackExposed,
    })),
    overallHealth: controlPlane?.overall ?? "unknown",
    pendingApprovalCount: pendingApprovals.length,
    partial: !canAdmin || !canApprove || !canReadWorkflows,
    notes,
  };
}
