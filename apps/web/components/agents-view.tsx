"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity,
  Bot,
  BrainCircuit,
  Check,
  CircleStop,
  Clock3,
  FileDiff,
  Search,
  ShieldCheck,
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

export function AgentDetailView({ tab = "overview" }: { tab?: string }) {
  const agent = demoAgents[0]!;
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
          {demoMode ? (
            tab === "learning" ? (
              <LearningPanel />
            ) : (
              <AgentOverview />
            )
          ) : tab === "learning" ? (
            <CleanLearningPanel />
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

function LearningPanel() {
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
        </div>
      </div>
      <div className="grid gap-4 wide:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="border bg-card">
          <div className="flex items-center justify-between border-b p-3">
            <div>
              <h2 className="font-display text-sm font-bold">
                Skill proposals
              </h2>
              <p className="text-xs text-muted-foreground">
                Self-authored changes awaiting review
              </p>
            </div>
            <Badge className="approval-surface text-[var(--color-warning)]">
              1 pending
            </Badge>
          </div>
          <article className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <FileDiff className="size-4 text-[var(--color-agent)]" />
              <code className="text-xs">correlate-legacy-auth@3</code>
              <Badge className="approval-surface text-[var(--color-warning)]">
                Proposed
              </Badge>
              <span className="ml-auto text-xs text-muted-foreground">
                RUN-1048 · 3 min ago
              </span>
            </div>
            <h3 className="mt-3 text-sm font-bold">
              Bound identity correlation to explicit evidence
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Require a matching identity plus at least one of source IP, owned
              endpoint, or a ten-minute window. Record contradictory matches.
            </p>
            <div className="mt-3 grid grid-cols-3 border text-center text-xs">
              <div className="border-r p-2">
                <span className="block text-muted-foreground">Evaluation</span>
                <strong>92 / 100</strong>
              </div>
              <div className="border-r p-2">
                <span className="block text-muted-foreground">Baseline</span>
                <strong>88 / 100</strong>
              </div>
              <div className="p-2">
                <span className="block text-muted-foreground">Regressions</span>
                <strong className="text-[var(--color-success)]">0</strong>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled
                title="Learning review is not available yet"
              >
                <ShieldCheck />
                Review and publish
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled
                title="Learning diff is not available yet"
              >
                View diff
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled
                title="Learning review is not available yet"
              >
                Reject
              </Button>
            </div>
          </article>
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
          </dl>
        </aside>
      </div>
      <section className="border bg-card">
        <div className="border-b p-3">
          <h2 className="font-display text-sm font-bold">
            Recent learning notes
          </h2>
        </div>
        {[
          [
            "lesson",
            "Legacy portal events use canonical identity after redaction",
            "98%",
            "RUN-1048",
            "3 evidence",
          ],
          [
            "failure",
            "Historical search must exclude closed false positives",
            "87%",
            "RUN-1041",
            "2 evidence",
          ],
          [
            "procedure_hint",
            "Tawny endpoint ownership resolves ambiguous usernames",
            "91%",
            "RUN-1032",
            "4 evidence",
          ],
        ].map(([kind, title, confidence, run, evidence]) => (
          <div
            key={title}
            className="grid grid-cols-[auto_1fr_auto] gap-3 border-b p-3 last:border-0 tablet:grid-cols-[7rem_1fr_5rem_7rem_6rem]"
          >
            <Badge className="agent-surface">{kind}</Badge>
            <p className="text-xs font-semibold">{title}</p>
            <span className="text-xs">{confidence}</span>
            <code className="hidden text-xs text-muted-foreground tablet:block">
              {run}
            </code>
            <span className="hidden text-xs text-muted-foreground tablet:block">
              {evidence}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
