import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  hasCapability,
  type AuthorisationSubject,
} from "@muster/authz";
import { database, schema } from "@muster/database";
import { getControlPlaneStatus } from "./control-plane-status.ts";
import { relativeTime } from "./utils.ts";
import type {
  ActivityEvent,
  AttentionItem,
  CommandMetric,
  RiskRadarCell,
} from "@/types/os";
import { toHealthState } from "@/types/status";

export type CommandSummary = {
  generatedAt: string;
  metrics: CommandMetric[];
  attention: AttentionItem[];
  riskRadar: RiskRadarCell[];
  activity: ActivityEvent[];
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
          createdAt: schema.tasks.createdAt,
          updatedAt: schema.tasks.updatedAt,
        })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.organisationId, subject.organisationId),
            isNull(schema.tasks.archivedAt),
            inArray(schema.tasks.status, [
              "backlog",
              "ready",
              "in_progress",
              "review",
            ]),
          ),
        )
        .orderBy(desc(schema.tasks.updatedAt))
        .limit(50)
    : [];

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

  const metrics: CommandMetric[] = [
    {
      id: "pending-approvals",
      label: "Pending approvals",
      value: pendingApprovals.length,
      tone: pendingApprovals.length > 0 ? "warning" : "default",
      href: "/approvals",
      ...(canApprove ? {} : { hint: "Requires workflows.approve" }),
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
      label: "Failed agent runs",
      value: failedAgentRuns,
      tone: failedAgentRuns > 0 ? "danger" : "default",
      href: "/agents",
    },
    {
      id: "failed-missions",
      label: "Failed mission runs",
      value: failedRuns.length,
      tone: failedRuns.length > 0 ? "danger" : "default",
      href: "/missions",
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
