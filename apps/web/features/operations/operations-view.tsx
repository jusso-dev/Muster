"use client";

import { useMemo, useState } from "react";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageHeader } from "@/components/page-header";
import {
  ApprovalStateBadge,
  OperationalStateBadge,
  SeverityBadge,
} from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTasks } from "@/lib/queries/hooks";
import { relativeTime } from "@/lib/utils";
import type { WorkItem } from "@/types/os";
import {
  toApprovalState,
  toOperationalState,
  type Severity,
} from "@/types/status";

type RawTask = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  organisationId?: string;
  assignedActorName?: string | null;
  assignee?: { displayName?: string | null } | null;
  relatedCaseId?: string | null;
  approvalRequired?: boolean;
  dueAt?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  agentRunStatus?: string | null;
};

function priorityToSeverity(priority: string): Severity {
  if (priority === "urgent") return "critical";
  if (priority === "high") return "high";
  if (priority === "low") return "low";
  return "medium";
}

function taskToWorkItem(task: RawTask): WorkItem {
  const createdAt =
    typeof task.createdAt === "string"
      ? task.createdAt
      : task.createdAt.toISOString();
  const updatedAt =
    typeof task.updatedAt === "string"
      ? task.updatedAt
      : task.updatedAt.toISOString();
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? "",
    category: "internal_task",
    organisationId: task.organisationId ?? "",
    severity: priorityToSeverity(task.priority),
    priority: task.priority,
    status: toOperationalState(task.status),
    ownerName:
      task.assignee?.displayName ?? task.assignedActorName ?? null,
    assignedAgentName: null,
    sourceSystem: "Muster tasks",
    externalRecordId: task.relatedCaseId ?? null,
    externalRecordUrl: null,
    systemOfRecord: task.relatedCaseId ? "Kelpie (linked)" : "Muster",
    dueAt: task.dueAt ?? null,
    createdAt,
    updatedAt,
    approvalState: toApprovalState(
      task.approvalRequired ? "pending" : "not-required",
    ),
    tags: [],
    source: "api",
  };
}

export function OperationsView() {
  const tasks = useTasks();
  const [mode, setMode] = useState<"list" | "board">("list");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = useMemo(() => {
    const raw = (tasks.data ?? []) as RawTask[];
    return raw.map(taskToWorkItem);
  }, [tasks.data]);

  const filtered = items.filter((item) =>
    statusFilter === "all" ? true : item.status === statusFilter,
  );

  const selected = filtered.find((item) => item.id === selectedId) ?? null;

  const columns = [
    "queued",
    "running",
    "waiting",
    "review",
    "completed",
    "failed",
  ] as const;

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Operations"
        title="Work queue"
        description="Unified coordination work. Authoritative records stay in Kelpie, Tawny, and other SoRs."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "list" ? "default" : "outline"}
              onClick={() => setMode("list")}
            >
              List
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "board" ? "default" : "outline"}
              onClick={() => setMode("board")}
            >
              Board
            </Button>
          </div>
        }
      />
      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 tablet:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="ops-status">
            Status
          </label>
          <select
            id="ops-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="all">All</option>
            {columns.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <Badge className="bg-muted text-muted-foreground">
            {filtered.length} items
          </Badge>
          <Badge className="bg-muted text-muted-foreground">
            Source: tasks API
          </Badge>
        </div>

        {tasks.isError ? (
          <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
        ) : null}
        {tasks.isLoading ? <SkeletonRows rows={6} /> : null}

        {!tasks.isLoading && filtered.length === 0 ? (
          <EmptyState
            title="No work items"
            description="Open tasks in this organisation appear here. Hunts and connector issues will join via adapters next."
          />
        ) : null}

        {mode === "list" && filtered.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <caption className="sr-only">Operations work items</caption>
                <thead className="border-b border-border bg-[var(--color-paper)] text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">SoR</th>
                    <th className="px-3 py-2">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setSelectedId(item.id)}
                    >
                      <td className="px-3 py-2.5 font-medium">{item.title}</td>
                      <td className="px-3 py-2.5">
                        <SeverityBadge severity={item.severity} />
                      </td>
                      <td className="px-3 py-2.5">
                        <OperationalStateBadge state={item.status} />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {item.ownerName ?? "Unassigned"}
                      </td>
                      <td className="px-3 py-2.5 text-xs">{item.systemOfRecord}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {relativeTime(item.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DetailDrawer item={selected} />
          </div>
        ) : null}

        {mode === "board" && filtered.length > 0 ? (
          <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-3 xl:grid-cols-6">
            {columns.map((column) => {
              const columnItems = filtered.filter(
                (item) => item.status === column,
              );
              return (
                <section
                  key={column}
                  className="min-w-[12rem] rounded-md border border-border bg-card"
                >
                  <header className="border-b border-border px-2 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    {column} ({columnItems.length})
                  </header>
                  <ul className="space-y-2 p-2">
                    {columnItems.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(item.id)}
                          className="w-full rounded-md border border-border bg-[var(--color-paper)] p-2 text-left hover:bg-muted/50"
                        >
                          <p className="text-xs font-semibold">{item.title}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <SeverityBadge severity={item.severity} compact />
                            <span className="text-xs text-muted-foreground">
                              {item.systemOfRecord}
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : null}

        {mode === "board" && selected ? (
          <DetailDrawer item={selected} />
        ) : null}
      </div>
    </CompanyOsShell>
  );
}

function DetailDrawer({ item }: { item: WorkItem | null }) {
  if (!item) {
    return (
      <aside className="rounded-md border border-border bg-card p-4 text-xs text-muted-foreground">
        Select a work item for coordination detail.
      </aside>
    );
  }
  return (
    <aside className="rounded-md border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{item.title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{item.description || "No description."}</p>
      <dl className="mt-3 space-y-2 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <OperationalStateBadge state={item.status} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Severity</dt>
          <dd>
            <SeverityBadge severity={item.severity} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Approval</dt>
          <dd>
            <ApprovalStateBadge state={item.approvalState} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">System of record</dt>
          <dd className="font-medium">{item.systemOfRecord}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">External id</dt>
          <dd className="font-mono text-xs">
            {item.externalRecordId ?? "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Id</dt>
          <dd className="break-all font-mono text-xs">{item.id}</dd>
        </div>
      </dl>
    </aside>
  );
}
