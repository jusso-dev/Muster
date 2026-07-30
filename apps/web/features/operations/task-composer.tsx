"use client";

import { useState } from "react";
import { Bot, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useCreateTask,
  useDelegateTask,
  type Assignee,
  type TaskRoom,
} from "@/lib/queries/hooks";
import { cn } from "@/lib/utils";

/**
 * What each pack agent is actually good for, in the words an operator would
 * use. These are prompts for the human, not instructions for the agent — the
 * agent's own system prompt and capability envelope stay server-side.
 */
const AGENT_BRIEFS: Record<
  string,
  { role: string; examples: string[]; wantsRoom: boolean }
> = {
  Parker: {
    role: "Ops lead — triage, briefs, case summaries",
    examples: [
      "Write a short ops brief on what matters right now",
      "Summarise open Kelpie cases and where SLA pressure is",
      "What should we look at first this morning?",
    ],
    wantsRoom: true,
  },
  Jessie: {
    role: "Threat hunting — endpoints, network, bounded hunts",
    examples: [
      "Check which Tawny hosts look unhealthy and why",
      "Run a bounded hunt for unusual outbound traffic",
      "Separate observed facts from inference on this host",
    ],
    wantsRoom: true,
  },
  Alfie: {
    role: "Research — CVEs, vendor advisories, evidence-backed briefs",
    examples: [
      "Brief me on this CVE and whether it affects us",
      "Summarise the vendor advisory with sources and confidence",
      "What is publicly known about this threat actor?",
    ],
    wantsRoom: false,
  },
};

function readinessTone(state: string | undefined) {
  if (state === "ready")
    return "bg-[var(--color-success-soft)] text-[var(--color-success)]";
  if (state === "degraded")
    return "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
  return "bg-muted text-muted-foreground";
}

export function AgentBriefCards({
  assignees,
  onPick,
}: {
  assignees: Assignee[];
  onPick: (agentId: string, example: string) => void;
}) {
  const agents = assignees.filter(
    (assignee) => assignee.actorType === "agent" && AGENT_BRIEFS[assignee.displayName],
  );
  if (agents.length === 0) return null;

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold">Hand work to the pack</h2>
        <p className="text-xs text-muted-foreground">
          Pick an example to start a task already assigned to that agent. You
          still review and dispatch it.
        </p>
      </div>
      <div className="grid gap-3 tablet:grid-cols-2 wide:grid-cols-3">
        {agents.map((agent) => {
          const brief = AGENT_BRIEFS[agent.displayName]!;
          const state = agent.readiness?.state;
          return (
            <article
              key={agent.id}
              className="rounded-md border border-border bg-card p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                    <Bot className="size-3.5 shrink-0" aria-hidden />
                    {agent.displayName}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {brief.role}
                  </p>
                </div>
                <Badge className={readinessTone(state)}>
                  {state ?? "unknown"}
                </Badge>
              </div>
              <ul className="mt-2 space-y-1">
                {brief.examples.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      onClick={() => onPick(agent.id, example)}
                      className="w-full rounded border border-border px-2 py-1.5 text-left text-xs text-muted-foreground hover:border-[var(--color-accent)] hover:text-foreground"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
              {state && state !== "ready" ? (
                <p className="mt-2 text-xs text-[var(--color-warning)]">
                  {agent.readiness?.reason ??
                    "Agent is not ready to accept work."}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export type ComposerSeed = { assignedActorId?: string; title?: string };

export function TaskComposer({
  assignees,
  rooms,
  seed,
  onClose,
}: {
  assignees: Assignee[];
  rooms: TaskRoom[];
  seed: ComposerSeed | null;
  onClose: () => void;
}) {
  const createTask = useCreateTask();
  const delegateTask = useDelegateTask();
  const [title, setTitle] = useState(seed?.title ?? "");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [assignedActorId, setAssignedActorId] = useState(
    seed?.assignedActorId ?? "",
  );
  const [roomId, setRoomId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const agents = assignees.filter((a) => a.actorType === "agent");
  const people = assignees.filter((a) => a.actorType === "human");
  const assignee = assignees.find((a) => a.id === assignedActorId) ?? null;
  const isAgent = assignee?.actorType === "agent";
  const agentReady = assignee?.readiness?.state === "ready";
  const busy = createTask.isPending || delegateTask.isPending;

  async function submit(dispatch: boolean) {
    setError(null);
    setNotice(null);
    if (!title.trim()) {
      setError("Give the task a title.");
      return;
    }
    try {
      const created = await createTask.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        priority,
        status: dispatch ? "ready" : "backlog",
        assignedActorId: assignedActorId || null,
        roomId: roomId || null,
      });
      if (dispatch) {
        const run = await delegateTask.mutateAsync(created.id);
        setNotice(
          `Dispatched to ${assignee?.displayName ?? "agent"} — run ${run.runId.slice(0, 8)} ${run.status}.`,
        );
      }
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create the task.",
      );
    }
  }

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">New task</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Assign to a person to coordinate, or to an agent and dispatch it for
            execution.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>

      <div className="mt-4 grid gap-3 tablet:grid-cols-2">
        <label className="tablet:col-span-2">
          <span className="mb-1 block text-xs font-medium">Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs doing?"
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          />
        </label>

        <label className="tablet:col-span-2">
          <span className="mb-1 block text-xs font-medium">
            Detail{" "}
            <span className="font-normal text-muted-foreground">
              — an agent receives this as the request
            </span>
          </span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            placeholder="Scope, hosts, time window, what a good answer looks like."
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium">Assign to</span>
          <select
            value={assignedActorId}
            onChange={(event) => setAssignedActorId(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">Unassigned</option>
            {agents.length > 0 ? (
              <optgroup label="Agents">
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.displayName}
                    {agent.readiness ? ` — ${agent.readiness.state}` : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {people.length > 0 ? (
              <optgroup label="People">
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-medium">Priority</span>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>

        <label className="tablet:col-span-2">
          <span className="mb-1 block text-xs font-medium">
            Room{" "}
            <span className="font-normal text-muted-foreground">
              — optional; gives the agent conversation context and a place to
              deliver evidence
            </span>
          </span>
          <select
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">No room</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.displayName || room.slug}
              </option>
            ))}
          </select>
        </label>
      </div>

      {assignee ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          {isAgent ? (
            <Bot className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          ) : (
            <User className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          )}
          <span>
            {isAgent
              ? (assignee.description ??
                "Agent will run under its governed capability envelope.")
              : "People are coordinated here; execution happens in their own tools."}
            {isAgent && !agentReady
              ? ` Dispatch is unavailable: ${assignee.readiness?.reason ?? "agent is not ready"}.`
              : ""}
          </span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-xs text-[var(--color-error)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 text-xs text-[var(--color-success)]">{notice}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void submit(false)}
        >
          Create task
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || !isAgent || !agentReady}
          title={
            !isAgent
              ? "Assign an agent to dispatch"
              : !agentReady
                ? "Agent is not ready"
                : undefined
          }
          className={cn(!isAgent || !agentReady ? "opacity-60" : "")}
          onClick={() => void submit(true)}
        >
          {busy ? "Working…" : "Create and dispatch"}
        </Button>
      </div>
    </section>
  );
}
