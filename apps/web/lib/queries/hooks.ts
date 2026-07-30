"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "@/lib/api/client";
import { queryKeys } from "@/lib/queries/keys";
import type {
  AuditEventSummary,
  MissionRunSummary,
  MissionSummary,
  SessionContext,
} from "@/types/os";
import type { CommandSummary } from "@/lib/command-summary-domain";

export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: async () => {
      const res = await apiGet<SessionContext>("/api/v1/session/me");
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useCommandSummary() {
  return useQuery({
    queryKey: queryKeys.commandSummary,
    queryFn: async () => {
      const res = await apiGet<CommandSummary>("/api/v1/command/summary");
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

export type ApprovalRecord = {
  id: string;
  actionType: string;
  riskSummary: string;
  requiredCapability: string;
  requiredApprovalCount: number;
  status: string;
  requestedAt: string;
  expiresAt: string;
  reason?: string | null;
  decisions?: unknown;
  target?: unknown;
  requestingActorId?: string;
};

export function useApprovals() {
  return useQuery({
    queryKey: queryKeys.approvals,
    queryFn: async () => {
      const res = await apiGet<ApprovalRecord[]>("/api/v1/approvals");
      return res.data;
    },
    refetchInterval: 20_000,
  });
}

export function useApprovalDecision() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: "approved" | "rejected";
      reason: string;
    }) => {
      const res = await apiPost<{ status: string; id: string; duplicate?: boolean }>(
        `/api/v1/approvals/${input.id}/decisions`,
        { status: input.status, reason: input.reason },
      );
      return res.data;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.approvals }),
        client.invalidateQueries({ queryKey: queryKeys.commandSummary }),
        client.invalidateQueries({ queryKey: ["audit"] }),
      ]);
    },
  });
}

export function useAgentsDirectory() {
  return useQuery({
    queryKey: queryKeys.agents,
    queryFn: async () => {
      const res = await apiGet<unknown[]>("/api/v1/agents");
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

export type DirectoryEntry = {
  id: string;
  displayName: string;
  avatar: string | null;
  actorType: "human" | "agent" | "system";
  status: string;
  capabilityAssignments: string[];
  jobTitle: string | null;
  team: string | null;
  presenceState: string | null;
  timezone: string | null;
  lastActiveAt: string | null;
};

/** Organisation-scoped humans and agents. Server filters by session capability. */
export function useDirectory(query = "") {
  return useQuery({
    queryKey: queryKeys.directory(query),
    queryFn: async () => {
      const res = await apiGet<DirectoryEntry[]>(
        "/api/v1/directory",
        query ? { q: query } : undefined,
      );
      return res.data;
    },
    staleTime: 30_000,
  });
}

export type AgentManifest = {
  key: string;
  version: string;
  name: string;
  description: string;
  invocationModes: string[];
  requiredCapabilities: string[];
  approvalBehavior: string;
  lifecycle: string;
};

/**
 * Governed capability packs published by the agent harness. This is the
 * authoritative install surface — the UI never grants anything.
 */
export function useAgentManifests() {
  return useQuery({
    queryKey: queryKeys.agentManifests,
    queryFn: async () => {
      const res = await apiGet<AgentManifest[]>(
        "/api/v1/agent-harness/manifests",
      );
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useMissions() {
  return useQuery({
    queryKey: queryKeys.missions,
    queryFn: async () => {
      const res = await apiGet<MissionSummary[]>("/api/v1/missions");
      return res.data;
    },
  });
}

export function useMission(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.mission(id ?? ""),
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await apiGet<MissionSummary>(`/api/v1/missions/${id}`);
      return res.data;
    },
  });
}

export function useMissionRuns(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.missionRuns(id ?? ""),
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await apiGet<MissionRunSummary[]>(
        `/api/v1/missions/${id}/runs`,
      );
      return res.data;
    },
  });
}

export type PackHandoffRow = {
  id: string;
  status: string;
  reason: string;
  summary: string;
  fromAgent: string;
  toAgent: string;
  requestedCapabilities: string[];
  evidenceReferences: string[];
  blockedReason: string | null;
  approvalId: string | null;
  targetRunId: string | null;
  taskId: string | null;
  missionId: string | null;
  createdAt: string;
  decidedAt: string | null;
  dispatchedAt: string | null;
};

/** Governed agent-to-agent handoffs for one task, mission, or room. */
export function usePackHandoffs(filters: {
  taskId?: string;
  missionId?: string;
  roomId?: string;
}) {
  const enabled = Boolean(filters.taskId || filters.missionId || filters.roomId);
  return useQuery({
    queryKey: queryKeys.packHandoffs(filters),
    enabled,
    queryFn: async () => {
      const res = await apiGet<PackHandoffRow[]>("/api/v1/pack-handoffs", {
        ...(filters.taskId ? { taskId: filters.taskId } : {}),
        ...(filters.missionId ? { missionId: filters.missionId } : {}),
        ...(filters.roomId ? { roomId: filters.roomId } : {}),
      });
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

export function useAuditEvents(filters: Record<string, string | undefined>) {
  return useQuery({
    queryKey: queryKeys.audit(filters),
    queryFn: async () => {
      const res = await apiGet<AuditEventSummary[]>(
        "/api/v1/audit/events",
        filters,
      );
      return { records: res.data, meta: res.meta };
    },
  });
}

export function useConnectors() {
  return useQuery({
    queryKey: queryKeys.connectors,
    queryFn: async () => {
      const res = await apiGet<unknown[]>("/api/v1/connectors");
      return res.data;
    },
  });
}

export function useControlPlane() {
  return useQuery({
    queryKey: queryKeys.controlPlane,
    queryFn: async () => {
      const res = await apiGet<unknown>("/api/v1/control-plane/status");
      return res.data;
    },
    refetchInterval: 30_000,
  });
}

export type AgentReadinessSummary = {
  state: "ready" | "degraded" | "unavailable" | string;
  reason: string;
};

export type Assignee = {
  id: string;
  displayName: string;
  actorType: "human" | "agent";
  description: string | null;
  readiness: AgentReadinessSummary | null;
};

export type TaskRoom = { id: string; slug: string; displayName: string };

/**
 * Tasks plus the assignee and room options the server is willing to accept.
 * Keeping meta here means the composer never invents an actor id.
 */
export function useTasks() {
  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: async () => {
      const res = await apiGet<{ tasks?: unknown[] } | unknown[]>(
        "/api/v1/tasks",
      );
      const data = res.data;
      const tasks = Array.isArray(data)
        ? data
        : data &&
            typeof data === "object" &&
            Array.isArray((data as { tasks?: unknown[] }).tasks)
          ? (data as { tasks: unknown[] }).tasks
          : [];
      const meta = (res.meta ?? {}) as {
        assignees?: Assignee[];
        rooms?: TaskRoom[];
      };
      return {
        tasks,
        assignees: meta.assignees ?? [],
        rooms: meta.rooms ?? [],
      };
    },
  });
}

export type CreateTaskInput = {
  title: string;
  description: string;
  priority: string;
  status?: string;
  assignedActorId: string | null;
  roomId: string | null;
};

export function useCreateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      const res = await apiPost<{ id: string }>("/api/v1/tasks", input);
      return res.data;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.tasks }),
        client.invalidateQueries({ queryKey: queryKeys.commandSummary }),
      ]);
    },
  });
}

/**
 * Hand a task to its assigned agent. The server re-checks capability,
 * readiness, and kill switch — this only asks.
 */
export function useDelegateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiPost<{ runId: string; status: string }>(
        `/api/v1/tasks/${taskId}/delegate`,
        {},
      );
      return res.data;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.tasks }),
        client.invalidateQueries({ queryKey: queryKeys.commandSummary }),
        client.invalidateQueries({ queryKey: ["audit"] }),
      ]);
    },
  });
}

/** PATCH task coordination state (status, assignee, …). Server-enforced. */
export function useUpdateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status?: string;
      priority?: string;
      title?: string;
      description?: string;
      assignedActorId?: string | null;
    }) => {
      const { id, ...body } = input;
      const res = await apiPatch<unknown>(`/api/v1/tasks/${id}`, body);
      return res.data;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.tasks }),
        client.invalidateQueries({ queryKey: queryKeys.commandSummary }),
      ]);
    },
  });
}
