"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  Bot,
  BrainCircuit,
  CircleStop,
  FileDiff,
  RefreshCcw,
  Search,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { demoAgents, demoMode } from "@/lib/demo-data";

export function AgentsView() {
  const [query, setQuery] = useState("");
  const agents = demoAgents.filter((agent) =>
    agent.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <AppShell>
      <PageHeader
        eyebrow="Tools"
        title="Agent directory"
        description="Permission-scoped human collaborators with governed learning"
        actions={
          <Button disabled title="Agent creation is not available yet">
            <Bot />
            New agent
          </Button>
        }
      />
      <div className="flex items-center gap-2 border-b bg-[var(--color-paper-2)] p-3">
        <label className="flex h-9 min-w-0 max-w-md flex-1 items-center gap-2 rounded-md border bg-background px-3">
          <Search className="size-4 text-muted-foreground" />
          <span className="sr-only">Search agents</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents…"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
        <Badge className="success-surface text-[var(--color-success)]">
          Gateway healthy
        </Badge>
      </div>
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto grid max-w-7xl gap-3 tablet:grid-cols-2 wide:grid-cols-3">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              href={`/agents/${agent.id}`}
              className="group border bg-card p-4 hover:border-[var(--color-agent)]"
            >
              <div className="flex items-start gap-3">
                <Avatar initials={agent.initials} agent size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-display text-sm font-bold group-hover:text-[var(--color-agent)]">
                      {agent.name}
                    </h2>
                    <Badge className="agent-surface">Agent</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {agent.purpose}
                  </p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-y py-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Runtime</dt>
                  <dd className="mt-0.5 truncate font-semibold">
                    {agent.runtime}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="mono mt-0.5 truncate">{agent.model}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last run</dt>
                  <dd className="mt-0.5 font-semibold">{agent.lastRun}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Success</dt>
                  <dd className="mt-0.5 font-semibold">{agent.successRate}</dd>
                </div>
              </dl>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {agent.tools.length} tools · {agent.rooms} rooms
                </span>
                <span
                  className={
                    agent.status === "running"
                      ? "text-[var(--color-agent)]"
                      : "text-[var(--color-success)]"
                  }
                >
                  {agent.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

const agentTabs = [
  "Overview",
  "Instructions",
  "Tools",
  "Permissions",
  "Rooms",
  "Runs",
  "Learning",
  "Evaluations",
  "Versions",
  "Audit",
];

export function AgentDetailView({
  agentId,
  tab = "overview",
}: {
  agentId: string;
  tab?: string;
}) {
  const agent =
    demoAgents.find((candidate) => candidate.id === agentId) ?? demoAgents[0]!;
  return (
    <AppShell>
      <PageHeader
        eyebrow="Agent"
        title={agent.name}
        description={`${agent.runtime} · ${agent.model} · owned by ${agent.owner}`}
        actions={
          <>
            {demoMode && (
              <Button
                variant="outline"
                disabled
                title="Run cancellation is not available yet"
              >
                <CircleStop />
                Cancel active run
              </Button>
            )}
            <Button disabled title="Assign work from Tasks">
              <Bot />
              Invoke
            </Button>
          </>
        }
      />
      <div className="flex items-center gap-3 border-b bg-[var(--color-paper-2)] px-4 py-3">
        <Avatar initials={agent.initials} agent size="lg" />
        <Badge className="agent-surface">Agent</Badge>
        <Badge className="success-surface text-[var(--color-success)]">
          Active
        </Badge>
        <span className="text-xs text-muted-foreground">
          {demoMode
            ? `${agent.successRate} success · last run ${agent.lastRun}`
            : "No runs yet"}
        </span>
        <Badge className="ml-auto bg-muted text-muted-foreground">
          Kill switch off
        </Badge>
      </div>
      <nav className="scroll-region flex overflow-x-auto border-b px-3">
        {agentTabs.map((item) => (
          <Link
            key={item}
            href={
              item === "Overview"
                ? `/agents/${agent.id}`
                : `/agents/${agent.id}/${item.toLowerCase()}`
            }
            className={`shrink-0 border-b-2 px-3 py-2.5 text-xs font-semibold ${tab === item.toLowerCase() ? "border-[var(--color-agent)] text-foreground" : "border-transparent text-muted-foreground"}`}
          >
            {item}
          </Link>
        ))}
      </nav>
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto max-w-6xl">
          {tab === "learning" ? (
            <GovernedLearningPanel agentId={agentId} />
          ) : demoMode ? (
            <AgentOverview />
          ) : (
            <CleanAgentOverview purpose={agent.purpose} />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function CleanAgentOverview({ purpose }: { purpose: string }) {
  return (
    <div className="grid gap-4 tablet:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="border bg-card p-4">
        <h2 className="font-display text-sm font-bold">Purpose</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {purpose}
        </p>
        <div className="mt-6 border border-dashed p-8 text-center">
          <Activity className="mx-auto size-5 text-muted-foreground" />
          <h3 className="mt-3 text-sm font-bold">No runs yet</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Assign a task or invoke this agent to create the first audited run.
          </p>
        </div>
      </section>
      <aside className="border bg-card p-3">
        <h2 className="font-display text-sm font-bold">Boundaries</h2>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Tools are capability-scoped. External actions require the configured
          human approval policy.
        </p>
      </aside>
    </div>
  );
}

function CleanLearningPanel() {
  return (
    <div className="border bg-card p-8 text-center">
      <BrainCircuit className="mx-auto size-6 text-[var(--color-agent)]" />
      <h2 className="mt-3 font-display text-sm font-bold">
        No learning proposals yet
      </h2>
      <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
        Evidence-linked notes and skill proposals appear after reviewed runs.
        Publication always requires evaluation and human approval.
      </p>
    </div>
  );
}

function AgentOverview() {
  return (
    <div className="grid gap-4 tablet:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <section className="border bg-card p-4">
          <h2 className="font-display text-sm font-bold">Purpose</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Correlates alert evidence, searches prior organisational security
            memory, and returns a typed disposition recommendation. It cannot
            execute response actions.
          </p>
        </section>
        <section className="border bg-card">
          <div className="border-b px-3 py-2.5">
            <h2 className="font-display text-sm font-bold">Recent runs</h2>
          </div>
          {[
            [
              "RUN-1048",
              "Legacy portal credential access",
              "Completed",
              "3 min ago",
              "94%",
            ],
            [
              "RUN-1041",
              "Impossible travel triage",
              "Completed",
              "41 min ago",
              "87%",
            ],
            ["RUN-1038", "Bower policy drift", "Failed", "2 h ago", "—"],
          ].map(([id, title, status, time, confidence]) => (
            <div
              key={id}
              className="grid grid-cols-[1fr_auto] gap-3 border-b p-3 last:border-0 tablet:grid-cols-[6rem_1fr_6rem_6rem_4rem]"
            >
              <code className="text-xs">{id}</code>
              <p className="text-xs font-semibold">{title}</p>
              <Badge
                className={
                  status === "Completed"
                    ? "success-surface text-[var(--color-success)]"
                    : "error-surface text-[var(--color-error)]"
                }
              >
                {status}
              </Badge>
              <span className="hidden text-xs text-muted-foreground tablet:block">
                {time}
              </span>
              <span className="hidden text-xs tablet:block">{confidence}</span>
            </div>
          ))}
        </section>
      </div>
      <aside className="space-y-4">
        <section className="border bg-card p-3">
          <h2 className="font-display text-sm font-bold">Boundaries</h2>
          <dl className="mt-3 space-y-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Runtime limit</dt>
              <dd>5 minutes</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Token budget</dt>
              <dd>20,000</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Cost ceiling</dt>
              <dd>AUD $5.00</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Classification</dt>
              <dd>Internal, restricted</dd>
            </div>
          </dl>
        </section>
      </aside>
    </div>
  );
}

type LearningState = {
  agent: {
    id: string;
    name: string;
    killSwitch: boolean;
    allowedTools: string[];
    capabilityRequirements: string[];
  };
  memories: Array<{
    id: string;
    kind: string;
    title: string;
    content: string;
    confidence: number;
    sourceRunId: string;
    evidenceReferences: unknown;
  }>;
  skills: Array<{
    id: string;
    skillKey: string;
    name: string;
    description: string;
    status: string;
    activeVersionId: string | null;
    versions: Array<{
      id: string;
      version: number;
      state: string;
      sourceRunId: string;
      basedOnVersionId: string | null;
      content: string;
      changeRationale: string;
      contentHash: string;
      evaluation: {
        passed: boolean;
        score: number;
        baselineScore: number | null;
        regressions: unknown;
      } | null;
      approval: { id: string; status: string } | null;
    }>;
  }>;
};

function GovernedLearningPanel({ agentId }: { agentId: string }) {
  const [learning, setLearning] = useState<LearningState | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  async function load() {
    const response = await fetch(`/api/v1/agents/${agentId}/learning`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      data?: LearningState;
      detail?: string;
    };
    if (!response.ok || !payload.data) {
      throw new Error(payload.detail ?? "Learning state could not be loaded");
    }
    setLearning(payload.data);
  }

  useEffect(() => {
    void load().catch((reason) =>
      setError(reason instanceof Error ? reason.message : "Load failed"),
    );
  }, [agentId]);

  async function mutate(input: Record<string, unknown>, key: string) {
    setPending(key);
    setError("");
    try {
      const response = await fetch(`/api/v1/agents/${agentId}/learning`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail ?? "Learning action failed");
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Action failed");
    } finally {
      setPending("");
    }
  }

  const proposals =
    learning?.skills.flatMap((skill) =>
      skill.versions.map((version) => ({ skill, version })),
    ) ?? [];

  return (
    <div className="space-y-4">
      <div className="border border-[var(--color-agent)] bg-[var(--color-agent-soft)] p-4">
        <div className="flex items-start gap-3">
          <BrainCircuit className="mt-0.5 size-5 text-[var(--color-agent)]" />
          <div>
            <h2 className="font-display text-sm font-bold">
              Governed continuous learning
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Run reviews produce evidence-linked notes and immutable skill
              proposals. Nothing enters trusted instructions until evaluation
              and human approval.
            </p>
          </div>
          {learning && (
            <Button
              className="ml-auto"
              size="sm"
              variant={learning.agent.killSwitch ? "default" : "outline"}
              disabled={pending === "kill-switch"}
              onClick={() =>
                void mutate(
                  {
                    action: "set_kill_switch",
                    enabled: !learning.agent.killSwitch,
                    reason: learning.agent.killSwitch
                      ? "Human operator restored governed execution"
                      : "Human operator paused agent execution",
                  },
                  "kill-switch",
                )
              }
            >
              {learning.agent.killSwitch ? <RefreshCcw /> : <ShieldOff />}
              {learning.agent.killSwitch ? "Restore agent" : "Kill switch"}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className="error-surface border p-3 text-xs text-[var(--color-error)]">
          {error}
        </p>
      )}
      <div className="grid gap-4 wide:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="border bg-card">
          <div className="flex items-center justify-between border-b p-3">
            <div>
              <h2 className="font-display text-sm font-bold">
                Skill proposals
              </h2>
              <p className="text-xs text-muted-foreground">
                Immutable versions with evidence, evaluation, and approval
              </p>
            </div>
            <Badge className="approval-surface text-[var(--color-warning)]">
              {
                proposals.filter(
                  ({ version }) =>
                    version.approval?.status === "pending" &&
                    version.state !== "rejected",
                ).length
              }{" "}
              pending
            </Badge>
          </div>
          {proposals.length === 0 ? (
            <div className="p-8 text-center">
              <FileDiff className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-2 text-xs text-muted-foreground">
                No skill proposals. Reviewed completed runs can propose one.
              </p>
            </div>
          ) : (
            proposals.map(({ skill, version }) => {
              const regressionCount = Array.isArray(
                version.evaluation?.regressions,
              )
                ? version.evaluation.regressions.length
                : 0;
              const active = skill.activeVersionId === version.id;
              return (
                <article
                  key={version.id}
                  className="border-b p-4 last:border-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <FileDiff className="size-4 text-[var(--color-agent)]" />
                    <code className="text-xs">
                      {skill.skillKey}@{version.version}
                    </code>
                    <Badge
                      className={
                        version.state === "published"
                          ? "success-surface text-[var(--color-success)]"
                          : "approval-surface text-[var(--color-warning)]"
                      }
                    >
                      {active ? "active" : version.state}
                    </Badge>
                    <code className="ml-auto text-xs text-muted-foreground">
                      {version.contentHash.slice(0, 12)}
                    </code>
                  </div>
                  <h3 className="mt-3 text-sm font-bold">{skill.name}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {version.changeRationale}
                  </p>
                  <pre className="mono scroll-region mt-3 max-h-48 overflow-auto border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                    {version.content}
                  </pre>
                  <div className="mt-3 grid grid-cols-3 border text-center text-xs">
                    <div className="border-r p-2">
                      <span className="block text-muted-foreground">
                        Evaluation
                      </span>
                      <strong>{version.evaluation?.score ?? "—"} / 100</strong>
                    </div>
                    <div className="border-r p-2">
                      <span className="block text-muted-foreground">
                        Baseline
                      </span>
                      <strong>
                        {version.evaluation?.baselineScore ?? "—"} / 100
                      </strong>
                    </div>
                    <div className="p-2">
                      <span className="block text-muted-foreground">
                        Regressions
                      </span>
                      <strong>{regressionCount}</strong>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!active && version.approval?.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending === version.id}
                          onClick={() =>
                            void mutate(
                              {
                                action: "evaluate_skill",
                                versionId: version.id,
                              },
                              version.id,
                            )
                          }
                        >
                          <ShieldCheck />
                          Evaluate
                        </Button>
                        <Button
                          size="sm"
                          disabled={
                            pending === version.id ||
                            !version.evaluation?.passed
                          }
                          onClick={() =>
                            void mutate(
                              {
                                action: "publish_skill",
                                versionId: version.id,
                                reason:
                                  "Human reviewed evidence, diff, and passing evaluation",
                              },
                              version.id,
                            )
                          }
                        >
                          Publish
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending === version.id}
                          onClick={() =>
                            void mutate(
                              {
                                action: "reject_skill",
                                versionId: version.id,
                                reason: "Human reviewer rejected proposal",
                              },
                              version.id,
                            )
                          }
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {active && version.basedOnVersionId && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending === version.id}
                        onClick={() =>
                          void mutate(
                            {
                              action: "rollback_skill",
                              versionId: version.id,
                              reason: "Human reviewer restored prior version",
                            },
                            version.id,
                          )
                        }
                      >
                        <RefreshCcw />
                        Roll back
                      </Button>
                    )}
                    {active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending === version.id}
                        onClick={() =>
                          void mutate(
                            {
                              action: "retire_skill",
                              versionId: version.id,
                              reason: "Human reviewer retired skill",
                            },
                            version.id,
                          )
                        }
                      >
                        Retire
                      </Button>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </section>
        <aside className="border bg-card">
          <div className="border-b p-3">
            <h2 className="font-display text-sm font-bold">Learning policy</h2>
          </div>
          <dl className="space-y-3 p-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Post-run review</dt>
              <dd className="font-semibold">Enabled for complex runs</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Memory retention</dt>
              <dd>90 days, evidence-linked</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Skill publication</dt>
              <dd>Evaluation + human approval</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Permission changes</dt>
              <dd className="text-[var(--color-error)]">
                Never self-authorised
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Allowed tools</dt>
              <dd>{learning?.agent.allowedTools.join(", ") || "None"}</dd>
            </div>
          </dl>
        </aside>
      </div>
      <section className="border bg-card">
        <div className="border-b p-3">
          <h2 className="font-display text-sm font-bold">
            Recent learning notes
          </h2>
        </div>
        {(learning?.memories ?? []).map((memory) => (
          <div
            key={memory.id}
            className="grid grid-cols-[auto_1fr_auto] gap-3 border-b p-3 last:border-0 tablet:grid-cols-[7rem_1fr_5rem_7rem_6rem]"
          >
            <Badge className="agent-surface">{memory.kind}</Badge>
            <div>
              <p className="text-xs font-semibold">{memory.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {memory.content}
              </p>
            </div>
            <span className="text-xs">{memory.confidence}%</span>
            <code className="hidden text-xs text-muted-foreground tablet:block">
              {memory.sourceRunId.slice(0, 8)}
            </code>
            <span className="hidden text-xs text-muted-foreground tablet:block">
              {Array.isArray(memory.evidenceReferences)
                ? `${memory.evidenceReferences.length} evidence`
                : "Evidence linked"}
            </span>
          </div>
        ))}
        {learning && learning.memories.length === 0 && (
          <p className="p-6 text-center text-xs text-muted-foreground">
            No evidence-linked learning notes yet.
          </p>
        )}
      </section>
    </div>
  );
}
