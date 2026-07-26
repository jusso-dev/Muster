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
  Plus,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { demoAgents, demoPeople } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

type TaskStatus = "backlog" | "ready" | "in_progress" | "review" | "done";
type TaskPriority = "urgent" | "high" | "normal" | "low";
type BoardTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedActorId: string | null;
  approvalRequired: boolean;
  dueAt: string | null;
  agentRunId: string | null;
  agentRunStatus: string | null;
  assignee: {
    id: string;
    displayName: string;
    actorType: "human" | "agent" | "product" | "service" | "system";
  } | null;
  room: { id: string; slug: string } | null;
};

const columns: Array<{ id: TaskStatus; label: string; hint: string }> = [
  { id: "backlog", label: "Backlog", hint: "Captured work" },
  { id: "ready", label: "Ready", hint: "Clear to start" },
  { id: "in_progress", label: "In progress", hint: "Human or agent working" },
  { id: "review", label: "Review", hint: "Needs human judgement" },
  { id: "done", label: "Done", hint: "Completed and recorded" },
];

const assignees = [
  ...demoAgents.map((actor) => ({
    id: actor.id,
    name: actor.name,
    initials: actor.initials,
    agent: true,
  })),
  ...demoPeople.map((actor) => ({
    id: actor.id,
    name: actor.name,
    initials: actor.initials,
    agent: false,
  })),
];
const defaultRoomId = "018f55d8-c4c7-7c3e-88ef-000000000100";
type TaskForm = {
  title: string;
  description: string;
  priority: TaskPriority;
  assignedActorId: string;
  roomId: string;
  approvalRequired: boolean;
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

export function TasksView() {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "agents" | "humans">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<TaskForm>({
    title: "",
    description: "",
    priority: "normal" as TaskPriority,
    assignedActorId: demoAgents[0]?.id ?? "",
    roomId: defaultRoomId,
    approvalRequired: false,
  });

  const loadTasks = useCallback(async () => {
    const response = await fetch("/api/v1/tasks", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load tasks");
    const payload = (await response.json()) as { data: BoardTask[] };
    setTasks(payload.data);
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

  useEffect(() => {
    const running = tasks.filter(
      (task) => task.agentRunId && task.agentRunStatus === "running",
    );
    if (running.length === 0) return;
    const timer = window.setInterval(() => {
      void Promise.all(
        running.map((task) =>
          fetch(`/api/v1/agent-runs/${task.agentRunId}`, { cache: "no-store" }),
        ),
      ).then(() => loadTasks());
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [loadTasks, tasks]);

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const matchesText =
          `${task.title} ${task.description} ${task.assignee?.displayName ?? ""}`
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

  async function updateTask(id: string, change: Record<string, unknown>) {
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
      setError("Task update failed");
      await loadTasks();
    }
  }

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          status: "backlog",
          investigationId: null,
        }),
      });
      if (!response.ok) throw new Error("Task creation failed");
      setForm((current) => ({ ...current, title: "", description: "" }));
      setComposerOpen(false);
      await loadTasks();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Task creation failed",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function delegate(task: BoardTask) {
    setError("");
    const response = await fetch(`/api/v1/tasks/${task.id}/delegate`, {
      method: "POST",
    });
    if (!response.ok) {
      const payload = (await response.json()) as { detail?: string };
      setError(payload.detail ?? "Agent delegation failed");
      return;
    }
    await loadTasks();
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Work"
        title="Tasks"
        description="Delegate bounded security work to people and permission-scoped agents"
        actions={
          <Button onClick={() => setComposerOpen(true)}>
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
          onSubmit={createTask}
          className="grid gap-3 border-b bg-card p-4 tablet:grid-cols-[minmax(16rem,1.5fr)_minmax(14rem,2fr)_10rem_14rem_auto]"
        >
          <label className="space-y-1">
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
          <label className="space-y-1">
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
              Assign to
            </span>
            <select
              value={form.assignedActorId}
              onChange={(event) =>
                setForm({ ...form, assignedActorId: event.target.value })
              }
              className="h-9 w-full rounded-md border bg-background px-2 text-xs"
            >
              {assignees.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.agent ? "Agent: " : "Person: "}
                  {actor.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Check />
              )}
              Create
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Cancel new task"
              onClick={() => setComposerOpen(false)}
            >
              <X />
            </Button>
          </div>
          <label className="flex items-center gap-2 tablet:col-span-full">
            <input
              type="checkbox"
              checked={form.approvalRequired}
              onChange={(event) =>
                setForm({ ...form, approvalRequired: event.target.checked })
              }
            />
            <span className="text-xs text-muted-foreground">
              Require human approval before any external action
            </span>
          </label>
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
                      const actor = task.assignee
                        ? assignees.find(
                            (candidate) => candidate.id === task.assignee?.id,
                          )
                        : null;
                      const agent = task.assignee?.actorType === "agent";
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
                                    <ShieldCheck /> Approval
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
                              initials={
                                actor?.initials ??
                                initials(
                                  task.assignee?.displayName ?? "Unassigned",
                                )
                              }
                              agent={agent}
                              size="sm"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold">
                                {task.assignee?.displayName ?? "Unassigned"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {agent ? "Agent assignee" : "Human assignee"}
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
                                    task.agentRunStatus === "running"
                                      ? "agent-surface"
                                      : "success-surface text-[var(--color-success)]",
                                  )}
                                >
                                  {task.agentRunStatus === "running" && (
                                    <LoaderCircle className="animate-spin" />
                                  )}
                                  Agent {task.agentRunStatus}
                                </Badge>
                              )}
                            </div>
                          )}

                          <div className="mt-3 flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-8 min-h-8 px-0"
                              disabled={columnIndex === 0}
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
                              disabled={columnIndex === columns.length - 1}
                              aria-label={`Move ${task.title} right`}
                              onClick={() =>
                                void updateTask(task.id, {
                                  status: columns[columnIndex + 1]?.id,
                                })
                              }
                            >
                              <ArrowRight />
                            </Button>
                            {agent &&
                              !task.agentRunId &&
                              task.status !== "done" && (
                                <Button
                                  size="sm"
                                  className="ml-auto"
                                  onClick={() => void delegate(task)}
                                >
                                  <Bot />
                                  {task.approvalRequired
                                    ? "Prepare draft"
                                    : "Delegate"}
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
