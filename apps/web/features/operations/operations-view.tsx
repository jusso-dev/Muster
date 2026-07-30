"use client";

import { useMemo, useState } from "react";
import { GripVertical } from "lucide-react";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { PackHandoffTimeline } from "@/components/os/pack-handoff-timeline";
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
import { useTasks, useUpdateTask } from "@/lib/queries/hooks";
import { cn, relativeTime } from "@/lib/utils";
import type { WorkItem } from "@/types/os";
import {
  toApprovalState,
  toOperationalState,
  type Severity,
} from "@/types/status";

/** Authoritative task statuses from contracts — board columns. */
const TASK_COLUMNS = [
  { id: "backlog", label: "Backlog", hint: "Not started" },
  { id: "ready", label: "Ready", hint: "Queued for work" },
  { id: "in_progress", label: "In progress", hint: "Active" },
  { id: "review", label: "Review", hint: "Needs decision" },
  { id: "done", label: "Done", hint: "Closed" },
] as const;

type TaskStatusId = (typeof TASK_COLUMNS)[number]["id"];

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

type BoardItem = WorkItem & { rawStatus: TaskStatusId };

function priorityToSeverity(priority: string): Severity {
  if (priority === "urgent") return "critical";
  if (priority === "high") return "high";
  if (priority === "low") return "low";
  return "medium";
}

function asTaskStatus(value: string): TaskStatusId {
  if (
    value === "backlog" ||
    value === "ready" ||
    value === "in_progress" ||
    value === "review" ||
    value === "done"
  ) {
    return value;
  }
  return "backlog";
}

function taskToBoardItem(task: RawTask): BoardItem {
  const createdAt =
    typeof task.createdAt === "string"
      ? task.createdAt
      : task.createdAt.toISOString();
  const updatedAt =
    typeof task.updatedAt === "string"
      ? task.updatedAt
      : task.updatedAt.toISOString();
  const rawStatus = asTaskStatus(task.status);
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? "",
    category: "internal_task",
    organisationId: task.organisationId ?? "",
    severity: priorityToSeverity(task.priority),
    priority: task.priority,
    status: toOperationalState(rawStatus),
    rawStatus,
    ownerName: task.assignee?.displayName ?? task.assignedActorName ?? null,
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
  const updateTask = useUpdateTask();
  const [mode, setMode] = useState<"list" | "board">("board");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const items = useMemo(() => {
    const raw = (tasks.data ?? []) as RawTask[];
    return raw.map(taskToBoardItem);
  }, [tasks.data]);

  const filtered = items.filter((item) =>
    statusFilter === "all" ? true : item.rawStatus === statusFilter,
  );

  const selected = filtered.find((item) => item.id === selectedId) ?? null;

  async function moveTask(id: string, status: TaskStatusId) {
    setMoveError(null);
    const current = items.find((item) => item.id === id);
    if (!current || current.rawStatus === status) return;
    try {
      await updateTask.mutateAsync({ id, status });
    } catch (error) {
      setMoveError(
        error instanceof Error ? error.message : "Could not update task status.",
      );
    }
  }

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Operations"
        title="Work queue"
        description="Coordination only. Kelpie/Tawny and other platforms stay systems of record. Drag cards on the board to change task status (server-enforced)."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "board" ? "default" : "outline"}
              onClick={() => setMode("board")}
            >
              Board
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "list" ? "default" : "outline"}
              onClick={() => setMode("list")}
            >
              List
            </Button>
          </div>
        }
      />
      <div className="mx-auto flex max-w-[100rem] flex-col gap-4 p-4 tablet:p-5">
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
            {TASK_COLUMNS.map((column) => (
              <option key={column.id} value={column.id}>
                {column.label}
              </option>
            ))}
          </select>
          <Badge className="bg-muted text-muted-foreground">
            {filtered.length} items
          </Badge>
          <Badge className="bg-muted text-muted-foreground">
            Source: live tasks API
          </Badge>
          {updateTask.isPending ? (
            <span className="text-xs text-muted-foreground">Saving…</span>
          ) : null}
        </div>

        {moveError ? (
          <p role="alert" className="text-xs text-[var(--color-error)]">
            {moveError}
          </p>
        ) : null}

        {tasks.isError ? (
          <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
        ) : null}
        {tasks.isLoading ? <SkeletonRows rows={6} /> : null}

        {!tasks.isLoading && filtered.length === 0 ? (
          <EmptyState
            title="No work items"
            description="Empty by design until real tasks exist for this organisation. No demo or fixture tasks are injected."
          />
        ) : null}

        {mode === "board" && filtered.length > 0 ? (
          <div className="overflow-x-auto pb-2">
            <div className="grid min-w-max grid-cols-5 gap-3">
              {TASK_COLUMNS.map((column) => {
                const columnItems = filtered.filter(
                  (item) => item.rawStatus === column.id,
                );
                return (
                  <section
                    key={column.id}
                    aria-label={`${column.label} column`}
                    className={cn(
                      "w-[17rem] rounded-md border bg-card",
                      dragOverColumn === column.id &&
                        "border-[var(--color-accent)] bg-muted/40",
                    )}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverColumn(column.id);
                    }}
                    onDragLeave={() =>
                      setDragOverColumn((current) =>
                        current === column.id ? null : current,
                      )
                    }
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragOverColumn(null);
                      const id = event.dataTransfer.getData("text/task-id");
                      if (id) void moveTask(id, column.id);
                    }}
                  >
                    <header className="flex items-center gap-2 border-b border-border px-2 py-2">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-xs font-semibold uppercase tracking-[0.06em]">
                          {column.label}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {column.hint}
                        </p>
                      </div>
                      <Badge className="bg-muted text-muted-foreground">
                        {columnItems.length}
                      </Badge>
                    </header>
                    <ul className="min-h-28 space-y-2 p-2">
                      {columnItems.map((item) => (
                        <li key={item.id}>
                          <article
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/task-id", item.id);
                            }}
                            onClick={() => setSelectedId(item.id)}
                            className={cn(
                              "group w-full cursor-grab rounded-md border border-border bg-[var(--color-paper)] p-2 text-left active:cursor-grabbing",
                              selectedId === item.id && "border-[var(--color-accent)]",
                            )}
                          >
                            <div className="flex items-start gap-1.5">
                              <GripVertical
                                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100"
                                aria-hidden
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold leading-snug">
                                  {item.title}
                                </p>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <SeverityBadge severity={item.severity} compact />
                                  <span className="text-xs text-muted-foreground">
                                    {item.systemOfRecord}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {item.ownerName ?? "Unassigned"} ·{" "}
                                  {relativeTime(item.updatedAt)}
                                </p>
                              </div>
                            </div>
                          </article>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>
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

        {mode === "board" && selected ? <DetailDrawer item={selected} /> : null}
      </div>
    </CompanyOsShell>
  );
}

function DetailDrawer({ item }: { item: BoardItem | WorkItem | null }) {
  if (!item) {
    return (
      <aside className="rounded-md border border-border bg-card p-4 text-xs text-muted-foreground">
        Select a work item for coordination detail. Drag cards between columns to
        update status.
      </aside>
    );
  }
  return (
    <aside className="rounded-md border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{item.title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {item.description || "No description."}
      </p>
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
          <dd className="font-mono text-xs">{item.externalRecordId ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Id</dt>
          <dd className="break-all font-mono text-xs">{item.id}</dd>
        </div>
      </dl>
      <div className="mt-3">
        <PackHandoffTimeline taskId={item.id} />
      </div>
    </aside>
  );
}
