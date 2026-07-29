"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api/client";
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

export function useTasks() {
  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: async () => {
      const res = await apiGet<{ tasks?: unknown[] } | unknown[]>(
        "/api/v1/tasks",
      );
      const data = res.data;
      if (Array.isArray(data)) return data;
      if (data && typeof data === "object" && Array.isArray((data as { tasks?: unknown[] }).tasks)) {
        return (data as { tasks: unknown[] }).tasks;
      }
      return [];
    },
  });
}
