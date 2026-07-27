"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bot,
  BrainCircuit,
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

type EvidenceState = "reported" | "unavailable" | "unknown";
type AgentReadiness = {
  state: "ready" | "needs_attention" | "unknown";
  reason: string;
  freshness: "fresh" | "stale" | "unknown";
  verifiedAt: string | null;
  ageSeconds: number | null;
  process: { current: boolean | null };
  lifecycle: { evidence: EvidenceState; state: string };
  evidence: {
    gateway: EvidenceState;
    authentication: EvidenceState;
    observer: EvidenceState;
    capabilities: EvidenceState;
    tools: EvidenceState;
    permissions: EvidenceState;
  };
  permissions: {
    requested: string;
    effective: string;
    diverges: boolean | null;
  };
  reported: {
    runtime: string | null;
    provider: string | null;
    model: string | null;
    inputCapabilities: string[];
    outputCapabilities: string[];
    availableCommands: string[];
    toolSources: string[];
    toolRiskClasses: string[];
    limitations: string[];
  };
};

type DirectoryAgent = {
  id: string;
  name: string;
  description: string;
  initials: string;
  configuredRuntime: string;
  configuredModel: string;
  owner: string;
  status: string;
  killSwitch: boolean;
  roomCount: number;
  allowedToolCount: number;
  readiness: AgentReadiness;
};

function readinessLabel(state: AgentReadiness["state"]) {
  if (state === "ready") return "Ready";
  if (state === "needs_attention") return "Needs attention";
  return "Unknown";
}

function readinessClass(state: AgentReadiness["state"]) {
  if (state === "ready")
    return "success-surface text-[var(--color-success)]";
  if (state === "needs_attention")
    return "approval-surface text-[var(--color-warning)]";
  return "bg-muted text-muted-foreground";
}

function verificationAge(readiness: AgentReadiness) {
  if (readiness.ageSeconds === null) return "Not verified";
  if (readiness.ageSeconds < 60) return `${readiness.ageSeconds}s ago`;
  return `${Math.floor(readiness.ageSeconds / 60)}m ago`;
}

export function AgentsView() {
  const [query, setQuery] = useState("");
  const [directory, setDirectory] = useState<DirectoryAgent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch("/api/v1/agents", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: DirectoryAgent[];
          detail?: string;
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.detail ?? "Agent directory unavailable");
        }
        setDirectory(payload.data);
      })
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "Agent directory failed",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const agents = directory.filter((agent) =>
    agent.name.toLowerCase().includes(query.toLowerCase()),
  );
  const gatewayState = directory.some(
    (agent) => agent.readiness.evidence.gateway === "reported",
  )
    ? "reported"
    : directory.some(
          (agent) => agent.readiness.evidence.gateway === "unavailable",
        )
      ? "unavailable"
      : "unknown";
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
        <Badge
          className={
            gatewayState === "reported"
              ? "success-surface text-[var(--color-success)]"
              : gatewayState === "unavailable"
                ? "error-surface text-[var(--color-error)]"
                : "bg-muted text-muted-foreground"
          }
        >
          Gateway {gatewayState}
        </Badge>
      </div>
      <div className="scroll-region min-h-0 flex-1 overflow-y-auto p-3 tablet:p-5">
        <div className="mx-auto grid max-w-7xl gap-3 tablet:grid-cols-2 wide:grid-cols-3">
          {loading && (
            <p className="text-xs text-muted-foreground">
              Loading authorised agent readiness…
            </p>
          )}
          {error && (
            <p className="text-xs text-[var(--color-error)]">{error}</p>
          )}
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
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {agent.description}
                  </p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-y py-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Runtime</dt>
                  <dd className="mt-0.5 truncate font-semibold">
                    {agent.configuredRuntime}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="mono mt-0.5 truncate">
                    {agent.configuredModel}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Readiness</dt>
                  <dd className="mt-0.5">
                    <Badge className={readinessClass(agent.readiness.state)}>
                      {readinessLabel(agent.readiness.state)}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Verified</dt>
                  <dd className="mt-0.5 font-semibold">
                    {verificationAge(agent.readiness)}
                  </dd>
                </div>
              </dl>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {agent.allowedToolCount} tools · {agent.roomCount} rooms
                </span>
                <span>{agent.readiness.reason}</span>
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
  const [agent, setAgent] = useState<DirectoryAgent | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setAgent(null);
    setError("");
    void fetch(`/api/v1/agents/${agentId}/readiness`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: DirectoryAgent;
          detail?: string;
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.detail ?? "Agent readiness unavailable");
        }
        setAgent(payload.data);
      })
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "Agent readiness failed",
        ),
      );
  }, [agentId]);

  if (!agent) {
    return (
      <AppShell>
        <PageHeader
          eyebrow="Agent"
          title="Agent readiness"
          description="Loading authorised runtime evidence"
        />
        <div className="p-6 text-xs text-muted-foreground">
          {error || "Loading…"}
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell>
      <PageHeader
        eyebrow="Agent"
        title={agent.name}
        description={`${agent.configuredRuntime} · ${agent.configuredModel} · owned by ${agent.owner}`}
        actions={
          <Button
            disabled
            title={
              agent.readiness.state === "ready"
                ? "Assign work from Tasks"
                : agent.readiness.reason
            }
          >
            <Bot />
            Invoke
          </Button>
        }
      />
      <div className="flex items-center gap-3 border-b bg-[var(--color-paper-2)] px-4 py-3">
        <Avatar initials={agent.initials} agent size="lg" />
        <Badge className="agent-surface">Agent</Badge>
        <Badge className={readinessClass(agent.readiness.state)}>
          {readinessLabel(agent.readiness.state)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {agent.readiness.reason} · verified{" "}
          {verificationAge(agent.readiness)}
        </span>
        <Badge className="ml-auto bg-muted text-muted-foreground">
          Kill switch {agent.killSwitch ? "on" : "off"}
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
          ) : tab === "versions" ? (
            <GovernedProfilePanel agentId={agentId} />
          ) : (
            <AgentOverview agent={agent} />
          )}
        </div>
      </div>
    </AppShell>
  );
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

type ProfileWorkRow = {
  roomId: string | null;
  status: string;
  trigger: string;
  startedAt: string | null;
  completedAt: string | null;
};

type ProfileSummaryState = {
  agent: { available: boolean };
  activeProfile: {
    displayName: string;
    description: string;
    role: string;
    communicationStyle: string;
    examplePrompts: unknown;
  } | null;
  recentRoomWork?: ProfileWorkRow[];
  recentRuns?: ProfileWorkRow[];
};

function AgentOverview({ agent }: { agent: DirectoryAgent }) {
  const evidence = Object.entries(agent.readiness.evidence);
  const [profile, setProfile] = useState<ProfileSummaryState | null>(null);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    setProfile(null);
    setProfileError("");
    void fetch(`/api/v1/agents/${agent.id}/profile`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: ProfileSummaryState;
          detail?: string;
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.detail ?? "Agent profile unavailable");
        }
        setProfile(payload.data);
      })
      .catch((reason) =>
        setProfileError(
          reason instanceof Error ? reason.message : "Agent profile failed",
        ),
      );
  }, [agent.id]);

  const examplePrompts = asStringArray(
    profile?.activeProfile?.examplePrompts,
  );
  const recentWork = profile?.recentRoomWork ?? profile?.recentRuns ?? [];

  return (
    <div className="grid gap-4 tablet:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <section className="border bg-card p-4">
          <h2 className="font-display text-sm font-bold">Purpose</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {agent.description}
          </p>
        </section>
        <section className="border bg-card p-4">
          <h2 className="font-display text-sm font-bold">Agent profile</h2>
          {profileError && (
            <p className="mt-2 text-xs text-[var(--color-error)]">
              {profileError}
            </p>
          )}
          <dl className="mt-3 grid gap-3 text-xs tablet:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Role</dt>
              <dd className="mt-0.5 font-semibold">
                {profile?.activeProfile?.role ?? "Not yet configured"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Communication style</dt>
              <dd className="mt-0.5 font-semibold">
                {profile?.activeProfile?.communicationStyle ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Availability</dt>
              <dd className="mt-0.5">
                <Badge
                  className={
                    profile?.agent.available
                      ? "success-surface text-[var(--color-success)]"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {profile?.agent.available ? "Available" : "Unavailable"}
                </Badge>
              </dd>
            </div>
          </dl>
          <div className="mt-4 border-t pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Example prompts
            </h3>
            {examplePrompts.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                {examplePrompts.map((prompt, index) => (
                  <li key={`${prompt}-${index}`}>&ldquo;{prompt}&rdquo;</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                No example prompts recorded for the active profile.
              </p>
            )}
          </div>
          {recentWork.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recent room work
              </h3>
              <ul className="mt-2 space-y-1 text-xs">
                {recentWork.slice(0, 5).map((run, index) => (
                  <li
                    key={`${run.roomId ?? "run"}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground"
                  >
                    <span className="font-semibold text-foreground">
                      {run.status}
                    </span>
                    <span>{run.trigger}</span>
                    <span>
                      {run.startedAt
                        ? new Date(run.startedAt).toLocaleString()
                        : "Not started"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="border bg-card p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Delegation readiness
              </p>
              <h2 className="mt-1 font-display text-lg font-bold">
                {readinessLabel(agent.readiness.state)}
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {agent.readiness.reason}
              </p>
            </div>
            <Badge className={readinessClass(agent.readiness.state)}>
              {agent.readiness.freshness}
            </Badge>
          </div>
          <details className="mt-4 border-t pt-3">
            <summary className="cursor-pointer text-xs font-semibold">
              Capabilities, permissions, and verification details
            </summary>
            <dl className="mt-3 grid gap-3 text-xs tablet:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Requested permission</dt>
                <dd className="mt-0.5 font-semibold">
                  {agent.readiness.permissions.requested}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Effective permission</dt>
                <dd className="mt-0.5 font-semibold">
                  {agent.readiness.permissions.effective}
                  {agent.readiness.permissions.diverges ? " · differs" : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Reported runtime</dt>
                <dd>{agent.readiness.reported.runtime ?? "unknown"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Provider / model</dt>
                <dd>
                  {agent.readiness.reported.provider ?? "unknown"} /{" "}
                  {agent.readiness.reported.model ?? "unknown"}
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {evidence.map(([name, state]) => (
                <Badge
                  key={name}
                  className={
                    state === "reported"
                      ? "success-surface text-[var(--color-success)]"
                      : state === "unavailable"
                        ? "error-surface text-[var(--color-error)]"
                        : "bg-muted text-muted-foreground"
                  }
                >
                  {name}: {state}
                </Badge>
              ))}
            </div>
            <div className="mt-4 grid gap-3 text-xs tablet:grid-cols-2">
              {[
                [
                  "Inputs",
                  agent.readiness.reported.inputCapabilities,
                ],
                [
                  "Outputs",
                  agent.readiness.reported.outputCapabilities,
                ],
                ["Commands", agent.readiness.reported.availableCommands],
                ["Tool sources", agent.readiness.reported.toolSources],
                ["Tool risk", agent.readiness.reported.toolRiskClasses],
                ["Known limits", agent.readiness.reported.limitations],
              ].map(([label, values]) => (
                <div key={label as string}>
                  <h3 className="font-semibold">{label as string}</h3>
                  <p className="mt-1 leading-5 text-muted-foreground">
                    {(values as string[]).join(", ") || "unknown"}
                  </p>
                </div>
              ))}
            </div>
          </details>
        </section>
      </div>
      <aside className="border bg-card p-3">
        <h2 className="font-display text-sm font-bold">Configured boundary</h2>
        <dl className="mt-3 space-y-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Runtime</dt>
            <dd>{agent.configuredRuntime}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Model</dt>
            <dd>{agent.configuredModel}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Allowed tools</dt>
            <dd>{agent.allowedToolCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Allowed rooms</dt>
            <dd>{agent.roomCount}</dd>
          </div>
        </dl>
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

type ProfileVersionState = "draft" | "approved" | "active" | "retired";

type ProfileVersionRow = {
  id: string;
  version: number;
  state: ProfileVersionState;
  displayName: string;
  role: string;
  basedOnVersionId: string | null;
  evaluation: {
    passed: boolean;
    score: number;
    baselineScore: number | null;
    regressions: unknown;
  } | null;
  approval: { id: string; status: string } | null;
};

type AdminProfileState = {
  agent: {
    id: string;
    name: string;
    killSwitch: boolean;
    status: string;
    available: boolean;
  };
  activeProfile: ProfileVersionRow | null;
  versions: ProfileVersionRow[];
};

function profileStateBadgeClass(state: ProfileVersionState) {
  if (state === "active") return "success-surface text-[var(--color-success)]";
  if (state === "approved")
    return "approval-surface text-[var(--color-warning)]";
  return "bg-muted text-muted-foreground";
}

function GovernedProfilePanel({ agentId }: { agentId: string }) {
  const [profile, setProfile] = useState<
    AdminProfileState | "forbidden" | null
  >(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  async function load() {
    const response = await fetch(`/api/v1/agents/${agentId}/profile`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      data?: Record<string, unknown>;
      detail?: string;
    };
    if (!response.ok || !payload.data) {
      throw new Error(
        payload.detail ?? "Profile versions could not be loaded",
      );
    }
    if (!("versions" in payload.data)) {
      setProfile("forbidden");
      return;
    }
    setProfile(payload.data as AdminProfileState);
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
      const response = await fetch(`/api/v1/agents/${agentId}/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail ?? "Profile action failed");
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Action failed");
    } finally {
      setPending("");
    }
  }

  if (profile === "forbidden") {
    return (
      <div className="border bg-card p-8 text-center">
        <ShieldCheck className="mx-auto size-6 text-muted-foreground" />
        <h2 className="mt-3 font-display text-sm font-bold">
          Administrator access required
        </h2>
        <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
          Versioned profile administration is limited to operators with
          agents.manage.
        </p>
      </div>
    );
  }

  const versions = profile?.versions ?? [];

  return (
    <div className="space-y-4">
      <div className="border border-[var(--color-agent)] bg-[var(--color-agent-soft)] p-4">
        <div className="flex items-start gap-3">
          <FileDiff className="mt-0.5 size-5 text-[var(--color-agent)]" />
          <div>
            <h2 className="font-display text-sm font-bold">
              Governed agent profile versions
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Every activation, approval, and rollback is evaluated and
              requires a distinct human approver.
            </p>
          </div>
          {profile && (
            <Badge className="ml-auto bg-muted text-muted-foreground">
              Kill switch {profile.agent.killSwitch ? "on" : "off"}
            </Badge>
          )}
        </div>
      </div>
      {error && (
        <p className="error-surface border p-3 text-xs text-[var(--color-error)]">
          {error}
        </p>
      )}
      <section className="border bg-card">
        <div className="border-b p-3">
          <h2 className="font-display text-sm font-bold">Profile versions</h2>
          <p className="text-xs text-muted-foreground">
            Immutable versions with evidence, evaluation, and approval
          </p>
        </div>
        {versions.length === 0 ? (
          <div className="p-8 text-center">
            <FileDiff className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-xs text-muted-foreground">
              No profile versions proposed yet.
            </p>
          </div>
        ) : (
          versions.map((version) => {
            const regressionCount = Array.isArray(
              version.evaluation?.regressions,
            )
              ? version.evaluation.regressions.length
              : 0;
            return (
              <article key={version.id} className="border-b p-4 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <FileDiff className="size-4 text-[var(--color-agent)]" />
                  <code className="text-xs">v{version.version}</code>
                  <Badge className={profileStateBadgeClass(version.state)}>
                    {version.state}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {version.role}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-bold">
                  {version.displayName}
                </h3>
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
                  {version.state === "draft" && !version.evaluation && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending === version.id}
                      onClick={() =>
                        void mutate(
                          { action: "evaluate_profile", versionId: version.id },
                          version.id,
                        )
                      }
                    >
                      <ShieldCheck />
                      Evaluate
                    </Button>
                  )}
                  {version.state === "draft" &&
                    version.evaluation &&
                    version.approval?.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          disabled={
                            pending === version.id ||
                            !version.evaluation?.passed
                          }
                          onClick={() =>
                            void mutate(
                              {
                                action: "approve_profile",
                                versionId: version.id,
                                reason:
                                  "Human reviewed evidence and passing evaluation",
                              },
                              version.id,
                            )
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending === version.id}
                          onClick={() =>
                            void mutate(
                              {
                                action: "reject_profile",
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
                  {version.state === "approved" && (
                    <Button
                      size="sm"
                      disabled={pending === version.id}
                      onClick={() =>
                        void mutate(
                          {
                            action: "activate_profile",
                            versionId: version.id,
                            reason: "Activated by administrator",
                          },
                          version.id,
                        )
                      }
                    >
                      Activate
                    </Button>
                  )}
                  {version.state === "active" && version.basedOnVersionId && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending === version.id}
                      onClick={() =>
                        void mutate(
                          {
                            action: "rollback_profile",
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
                  {version.state !== "active" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending === version.id}
                      onClick={() =>
                        void mutate(
                          {
                            action: "retire_profile",
                            versionId: version.id,
                            reason: "Retired by administrator",
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
    </div>
  );
}
