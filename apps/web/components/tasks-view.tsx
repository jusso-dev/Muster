"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  CircleDot,
  Filter,
  GripVertical,
  Hash,
  ListTodo,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Square,
  UserRound,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TaskStatus = "backlog" | "ready" | "in_progress" | "review" | "done";
type TaskPriority = "urgent" | "high" | "normal" | "low";
type BoardAssignee = {
  id: string;
  displayName: string;
  actorType: "human" | "agent";
};
type BoardRoom = { id: string; slug: string; displayName: string };
type AgentRun = {
  id: string;
  status: string;
  runtime: string;
  model: string;
  tokenUsage: unknown;
  estimatedCostCents: number;
  structuredOutput: unknown;
  outputHash: string | null;
  error: string | null;
  cancellationReason: string | null;
};
type BoardTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedActorId: string | null;
  roomId: string | null;
  relatedCaseId: string | null;
  approvalRequired: boolean;
  dueAt: string | null;
  agentRunId: string | null;
  agentRunStatus: string | null;
  assignee: BoardAssignee | null;
  room: Pick<BoardRoom, "id" | "slug"> | null;
  run: AgentRun | null;
};
type TaskForm = {
  title: string;
  description: string;
  priority: TaskPriority;
  assignedActorId: string;
  roomId: string;
  relatedCaseId: string;
  approvalRequired: boolean;
  dueAt: string;
};

const columns: Array<{ id: TaskStatus; label: string; hint: string }> = [
  { id: "backlog", label: "Backlog", hint: "Captured work" },
  { id: "ready", label: "Ready", hint: "Clear to start" },
  { id: "in_progress", label: "In progress", hint: "Human or agent working" },
  { id: "review", label: "Review", hint: "Needs human judgement" },
  { id: "done", label: "Done", hint: "Completed and recorded" },
];

const emptyForm: TaskForm = {
  title: "",
  description: "",
  priority: "normal",
  assignedActorId: "",
  roomId: "",
  relatedCaseId: "",
  approvalRequired: false,
  dueAt: "",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function priorityClass(priority: TaskPriority) {
  if (priority === "urgent") return "severity-critical";
  if (priority === "high") return "severity-high";
  if (priority === "low") return "severity-low";
  return "bg-muted text-muted-foreground";
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

async function responseDetail(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as {
    detail?: string;
  } | null;
  return payload?.detail ?? fallback;
}

export function TasksView() {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [assignees, setAssignees] = useState<BoardAssignee[]>([]);
  const [rooms, setRooms] = useState<BoardRoom[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "agents" | "humans">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskForm>(emptyForm);

  const loadTasks = useCallback(async () => {
    const response = await fetch("/api/v1/tasks", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load tasks");
    const payload = (await response.json()) as {
      data: BoardTask[];
      meta: { assignees: BoardAssignee[]; rooms: BoardRoom[] };
    };
    setTasks(payload.data);
    setAssignees(payload.meta.assignees);
    setRooms(payload.meta.rooms);
    setForm((current) => ({
      ...current,
      assignedActorId:
        current.assignedActorId ||
        payload.meta.assignees.find((actor) => actor.actorType === "agent")
          ?.id ||
        "",
      roomId: current.roomId || payload.meta.rooms[0]?.id || "",
    }));
  }, []);

  useEffect(() => {
    void loadTasks()
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "Could not load tasks",
        ),
      )
      .finally(() => setLoading(false));
  }, [loadTasks]);

  const runningTaskIds = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            task.agentRunId &&
            (task.agentRunStatus === "queued" ||
              task.agentRunStatus === "running"),
        )
        .map((task) => task.id),
    [tasks],
  );
  const runningKey = runningTaskIds.join(",");

  useEffect(() => {
    if (!runningKey) return;
    const streams = runningTaskIds.map((taskId) => {
      const stream = new EventSource(`/api/v1/tasks/${taskId}/events`);
      stream.addEventListener("settled", () => {
        stream.close();
        void loadTasks();
      });
      stream.onerror = () => stream.close();
      return stream;
    });
    const fallback = window.setInterval(() => void loadTasks(), 2_000);
    return () => {
      streams.forEach((stream) => stream.close());
      window.clearInterval(fallback);
    };
  }, [loadTasks, runningKey]);

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const matchesText =
          `${task.title} ${task.description} ${task.room?.slug ?? ""} ${task.assignee?.displayName ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase());
        const matchesActor =
          filter === "all" ||
          (filter === "agents" && task.assignee?.actorType === "agent") ||
          (filter === "humans" && task.assignee?.actorType === "human");
        return matchesText && matchesActor;
      }),
    [filter, query, tasks],
  );

  function resetComposer() {
    setEditingTaskId(null);
    setComposerOpen(false);
    setForm({
      ...emptyForm,
      assignedActorId:
        assignees.find((actor) => actor.actorType === "agent")?.id ?? "",
      roomId: rooms[0]?.id ?? "",
    });
  }

  function editTask(task: BoardTask) {
    setEditingTaskId(task.id);
    setForm({
      title: task.title,
      description: task.description,
      priority: task.priority,
      assignedActorId: task.assignedActorId ?? "",
      roomId: task.roomId ?? "",
      relatedCaseId: task.relatedCaseId ?? "",
      approvalRequired: task.approvalRequired,
      dueAt: toLocalDateTime(task.dueAt),
    });
    setComposerOpen(true);
  }

  async function updateTask(id: string, change: Record<string, unknown>) {
    const before = tasks;
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? ({ ...task, ...change } as BoardTask) : task,
      ),
    );
    const response = await fetch(`/api/v1/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change),
    });
    if (!response.ok) {
      setTasks(before);
      setError(await responseDetail(response, "Task update failed"));
    } else {
      await loadTasks();
    }
  }

  async function submitTask(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(
        editingTaskId ? `/api/v1/tasks/${editingTaskId}` : "/api/v1/tasks",
        {
          method: editingTaskId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...form,
            assignedActorId: form.assignedActorId || null,
            roomId: form.roomId || null,
            relatedCaseId: form.relatedCaseId || null,
            dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
            ...(!editingTaskId
              ? { status: "backlog", investigationId: null }
              : {}),
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await responseDetail(
            response,
            editingTaskId ? "Task update failed" : "Task creation failed",
          ),
        );
      }
      resetComposer();
      await loadTasks();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(task: BoardTask, action: "delegate" | "cancel") {
    setPendingTaskId(task.id);
    setError("");
    try {
      const response = await fetch(`/api/v1/tasks/${task.id}/${action}`, {
        method: "POST",
        ...(action === "delegate"
          ? {
              headers: {
                "Idempotency-Key": `task:${task.id}:after:${task.agentRunId ?? "initial"}`,
              },
            }
          : {}),
      });
      if (!response.ok) {
        throw new Error(
          await responseDetail(
            response,
            action === "cancel"
              ? "Agent cancellation failed"
              : "Agent delegation failed",
          ),
        );
      }
      await loadTasks();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task action failed");
    } finally {
      setPendingTaskId(null);
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Work"
        title="Tasks"
        description="Delegate bounded security work to people and permission-scoped agents"
        actions={
          <Button
            onClick={() => {
              setEditingTaskId(null);
              setComposerOpen(true);
            }}
          >
            <Plus /> New task
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b bg-[var(--color-paper-2)] p-3">
        <label className="flex h-9 min-w-56 flex-1 items-center gap-2 rounded-md border bg-background px-3 tablet:max-w-md">
          <Search className="size-4 text-muted-foreground" />
          <span className="sr-only">Search tasks</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks, rooms, and assignees"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
        <div
          className="flex items-center gap-1"
          aria-label="Task assignee filter"
        >
          <Filter className="mx-1 size-3.5 text-muted-foreground" />
          {(["all", "agents", "humans"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "secondary" : "ghost"}
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
            >
              {value === "agents" ? (
                <Bot />
              ) : value === "humans" ? (
                <UserRound />
              ) : (
                <ListTodo />
              )}
              <span className="capitalize">{value}</span>
            </Button>
          ))}
        </div>
        <Badge className="bg-muted text-muted-foreground">
          {visibleTasks.length} shown
        </Badge>
      </div>

      {composerOpen && (
        <form
          onSubmit={submitTask}
          aria-label={editingTaskId ? "Edit task" : "Create task"}
          className="grid gap-3 border-b bg-card p-4 tablet:grid-cols-2 desktop:grid-cols-6"
        >
          <label className="space-y-1 desktop:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Task
            </span>
            <input
              autoFocus
              required
              maxLength={240}
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
              placeholder="What needs doing?"
              className="h-9 w-full rounded-md border bg-background px-3 text-xs outline-none"
            />
          </label>
          <label className="space-y-1 desktop:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Expected outcome
            </span>
            <input
              maxLength={4_000}
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
              placeholder="Context, constraints, and deliverable"
              className="h-9 w-full rounded-md border bg-background px-3 text-xs outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Priority
            </span>
            <select
              value={form.priority}
              onChange={(event) =>
                setForm({
                  ...form,
                  priority: event.target.value as TaskPriority,
                })
              }
              className="h-9 w-full rounded-md border bg-background px-2 text-xs"
            >
              {(["urgent", "high", "normal", "low"] as const).map(
                (priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Due
            </span>
            <input
              type="datetime-local"
              value={form.dueAt}
              onChange={(event) =>
                setForm({ ...form, dueAt: event.target.value })
              }
              className="h-9 w-full rounded-md border bg-background px-2 text-xs"
            />
          </label>
          <label className="space-y-1 desktop:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assign to
            </span>
            <select
              value={form.assignedActorId}
              onChange={(event) =>
                setForm({ ...form, assignedActorId: event.target.value })
              }
              className="h-9 w-full rounded-md border bg-background px-2 text-xs"
            >
              <option value="">Unassigned</option>
              {assignees.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.actorType === "agent" ? "Agent: " : "Person: "}
                  {actor.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 desktop:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Room
            </span>
            <select
              value={form.roomId}
              onChange={(event) =>
                setForm({ ...form, roomId: event.target.value })
              }
              className="h-9 w-full rounded-md border bg-background px-2 text-xs"
            >
              <option value="">No room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  #{room.slug}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Case reference
            </span>
            <input
              maxLength={160}
              value={form.relatedCaseId}
              onChange={(event) =>
                setForm({ ...form, relatedCaseId: event.target.value })
              }
              placeholder="Optional case ID"
              className="h-9 w-full rounded-md border bg-background px-3 text-xs outline-none"
            />
          </label>
          <label className="flex items-center gap-2 desktop:col-span-2">
            <input
              type="checkbox"
              checked={form.approvalRequired}
              onChange={(event) =>
                setForm({ ...form, approvalRequired: event.target.checked })
              }
            />
            <span className="text-xs text-muted-foreground">
              External actions stay drafts until human approval
            </span>
          </label>
          <div className="flex items-end gap-2 desktop:col-span-full">
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Check />
              )}
              {editingTaskId ? "Save task" : "Create task"}
            </Button>
            <Button type="button" variant="ghost" onClick={resetComposer}>
              <X /> Cancel
            </Button>
          </div>
        </form>
      )}

      {error && (
        <div
          role="alert"
          className="error-surface border-b border-[var(--color-error)] px-4 py-2 text-xs text-[var(--color-error)]"
        >
          {error}
        </div>
      )}

      <div className="scroll-region min-h-0 flex-1 overflow-auto p-3 tablet:p-4">
        {loading ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            <LoaderCircle className="mb-2 size-5 animate-spin" /> Loading tasks
          </div>
        ) : (
          <div className="grid min-w-max grid-cols-5 gap-3">
            {columns.map((column, columnIndex) => {
              const columnTasks = visibleTasks.filter(
                (task) => task.status === column.id,
              );
              return (
                <section
                  key={column.id}
                  className="w-[18.5rem] rounded-lg border bg-[var(--color-paper-2)]"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const id = event.dataTransfer.getData("text/task-id");
                    if (id) void updateTask(id, { status: column.id });
                  }}
                >
                  <header className="flex items-center gap-2 border-b px-3 py-2.5">
                    <CircleDot className="size-3.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-xs font-bold">{column.label}</h2>
                      <p className="text-xs text-muted-foreground">
                        {column.hint}
                      </p>
                    </div>
                    <Badge className="bg-muted text-muted-foreground">
                      {columnTasks.length}
                    </Badge>
                  </header>
                  <div className="min-h-28 space-y-2 p-2">
                    {columnTasks.map((task) => {
                      const agent = task.assignee?.actorType === "agent";
                      const running =
                        task.agentRunStatus === "running" ||
                        task.agentRunStatus === "queued";
                      const retryable =
                        task.agentRunStatus === "failed" ||
                        task.agentRunStatus === "cancelled";
                      return (
                        <article
                          key={task.id}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/task-id", task.id);
                          }}
                          className="group rounded-md border bg-card p-3 shadow-[0_1px_0_var(--shadow-hairline)] hover:border-[var(--color-rule-strong)]"
                        >
                          <div className="flex items-start gap-2">
                            <GripVertical
                              className="mt-0.5 size-3.5 cursor-grab text-muted-foreground opacity-50 group-hover:opacity-100"
                              aria-hidden="true"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge
                                  className={cn(
                                    "capitalize",
                                    priorityClass(task.priority),
                                  )}
                                >
                                  {task.priority}
                                </Badge>
                                {task.approvalRequired && (
                                  <Badge className="approval-surface text-[var(--color-warning)]">
                                    <ShieldCheck /> Draft only
                                  </Badge>
                                )}
                              </div>
                              <h3 className="mt-2 text-sm font-bold leading-5">
                                {task.title}
                              </h3>
                              <p className="mt-1 line-clamp-3 text-xs leading-4 text-muted-foreground">
                                {task.description}
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center gap-2 border-t pt-2.5">
                            <Avatar
                              initials={initials(
                                task.assignee?.displayName ?? "Unassigned",
                              )}
                              agent={agent}
                              size="sm"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold">
                                {task.assignee?.displayName ?? "Unassigned"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {agent
                                  ? "Agent assignee"
                                  : task.assignee
                                    ? "Human assignee"
                                    : "No assignee"}
                              </p>
                            </div>
                            {task.room && (
                              <span className="flex max-w-24 items-center gap-1 truncate text-xs text-muted-foreground">
                                <Hash className="size-3" />
                                {task.room.slug}
                              </span>
                            )}
                          </div>

                          {(task.dueAt || task.agentRunStatus) && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                              {task.dueAt && (
                                <>
                                  <CalendarClock className="size-3" />
                                  <span>
                                    {new Date(task.dueAt).toLocaleString(
                                      "en-AU",
                                      {
                                        day: "numeric",
                                        month: "short",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      },
                                    )}
                                  </span>
                                </>
                              )}
                              {task.agentRunStatus && (
                                <Badge
                                  className={cn(
                                    "ml-auto",
                                    running
                                      ? "agent-surface"
                                      : task.agentRunStatus === "completed"
                                        ? "success-surface text-[var(--color-success)]"
                                        : "error-surface text-[var(--color-error)]",
                                  )}
                                >
                                  {running && (
                                    <LoaderCircle className="animate-spin" />
                                  )}
                                  Agent {task.agentRunStatus}
                                </Badge>
                              )}
                            </div>
                          )}

                          {task.relatedCaseId && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Case {task.relatedCaseId}
                            </p>
                          )}

                          {task.run &&
                            (task.run.structuredOutput ||
                              task.run.error ||
                              task.run.cancellationReason) && (
                              <details className="mt-3 rounded-md border bg-muted/30 p-2 text-xs">
                                <summary className="cursor-pointer font-semibold">
                                  Agent output and evidence
                                </summary>
                                {(task.run.error ||
                                  task.run.cancellationReason) && (
                                  <p className="mt-2 text-[var(--color-error)]">
                                    {task.run.error ??
                                      task.run.cancellationReason}
                                  </p>
                                )}
                                {task.run.structuredOutput !== null && (
                                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                                    {JSON.stringify(
                                      task.run.structuredOutput,
                                      null,
                                      2,
                                    )}
                                  </pre>
                                )}
                                <dl className="mt-2 grid grid-cols-2 gap-1 text-muted-foreground">
                                  <dt>Runtime</dt>
                                  <dd>{task.run.runtime}</dd>
                                  <dt>Model</dt>
                                  <dd>{task.run.model}</dd>
                                  <dt>Tokens</dt>
                                  <dd>{JSON.stringify(task.run.tokenUsage)}</dd>
                                  <dt>Estimated cost</dt>
                                  <dd>
                                    $
                                    {(
                                      task.run.estimatedCostCents / 100
                                    ).toFixed(2)}
                                  </dd>
                                  {task.run.outputHash && (
                                    <>
                                      <dt>Output hash</dt>
                                      <dd className="truncate">
                                        {task.run.outputHash}
                                      </dd>
                                    </>
                                  )}
                                </dl>
                              </details>
                            )}

                          <div className="mt-3 flex flex-wrap items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-8 min-h-8 px-0"
                              disabled={columnIndex === 0 || running}
                              aria-label={`Move ${task.title} left`}
                              onClick={() =>
                                void updateTask(task.id, {
                                  status: columns[columnIndex - 1]?.id,
                                })
                              }
                            >
                              <ArrowLeft />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-8 min-h-8 px-0"
                              disabled={
                                columnIndex === columns.length - 1 || running
                              }
                              aria-label={`Move ${task.title} right`}
                              onClick={() =>
                                void updateTask(task.id, {
                                  status: columns[columnIndex + 1]?.id,
                                })
                              }
                            >
                              <ArrowRight />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-8 min-h-8 px-0"
                              aria-label={`Edit ${task.title}`}
                              onClick={() => editTask(task)}
                            >
                              <Pencil />
                            </Button>
                            {agent && running && (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="ml-auto"
                                disabled={pendingTaskId === task.id}
                                onClick={() => void runAction(task, "cancel")}
                              >
                                <Square /> Cancel
                              </Button>
                            )}
                            {agent &&
                              !running &&
                              task.status !== "done" &&
                              (retryable || !task.agentRunId) && (
                                <Button
                                  size="sm"
                                  className="ml-auto"
                                  disabled={pendingTaskId === task.id}
                                  onClick={() =>
                                    void runAction(task, "delegate")
                                  }
                                >
                                  {retryable ? <RotateCcw /> : <Bot />}
                                  {retryable
                                    ? "Retry"
                                    : task.approvalRequired
                                      ? "Prepare draft"
                                      : "Delegate"}
                                </Button>
                              )}
                            {task.status === "review" && (
                              <Button
                                size="sm"
                                className="ml-auto"
                                onClick={() =>
                                  void updateTask(task.id, { status: "done" })
                                }
                              >
                                <Check /> Mark done
                              </Button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    {columnTasks.length === 0 && (
                      <div className="grid min-h-24 place-items-center rounded-md border border-dashed px-4 text-center text-xs text-muted-foreground">
                        Drop tasks here
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
