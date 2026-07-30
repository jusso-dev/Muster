"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageBody } from "@/components/os/page-body";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDirectory, type DirectoryEntry } from "@/lib/queries/hooks";
import { queryKeys } from "@/lib/queries/keys";
import { relativeTime } from "@/lib/utils";

const UNASSIGNED = "No team recorded";

const ACTOR_TYPE_ORDER = ["human", "agent", "system"] as const;

const ACTOR_TYPE_LABELS: Record<DirectoryEntry["actorType"], string> = {
  human: "People",
  agent: "Pack agents",
  system: "System actors",
};

type DirectoryGroup = { key: string; label: string; members: DirectoryEntry[] };

const byDisplayName = (left: DirectoryEntry, right: DirectoryEntry) =>
  left.displayName.localeCompare(right.displayName);

function groupDirectory(entries: DirectoryEntry[]): {
  groupedBy: "team" | "actorType";
  groups: DirectoryGroup[];
} {
  if (entries.some((entry) => entry.team?.trim())) {
    const teams = new Map<string, DirectoryEntry[]>();
    for (const entry of entries) {
      const team = entry.team?.trim() || UNASSIGNED;
      const bucket = teams.get(team);
      if (bucket) bucket.push(entry);
      else teams.set(team, [entry]);
    }
    return {
      groupedBy: "team",
      groups: [...teams.entries()]
        .sort(([left], [right]) =>
          left === UNASSIGNED
            ? 1
            : right === UNASSIGNED
              ? -1
              : left.localeCompare(right),
        )
        .map(([team, members]) => ({
          key: team,
          label: team,
          members: members.sort(byDisplayName),
        })),
    };
  }

  return {
    groupedBy: "actorType",
    groups: ACTOR_TYPE_ORDER.map((actorType) => ({
      key: actorType,
      label: ACTOR_TYPE_LABELS[actorType],
      members: entries
        .filter((entry) => entry.actorType === actorType)
        .sort(byDisplayName),
    })).filter((group) => group.members.length > 0),
  };
}

function MemberRow({
  member,
  busy,
  onDeactivate,
}: {
  member: DirectoryEntry;
  busy: boolean;
  onDeactivate: (id: string) => void;
}) {
  const capabilities = member.capabilityAssignments ?? [];
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {member.displayName}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {member.jobTitle ??
            (member.actorType === "agent" ? "Pack agent" : "—")}
          {member.timezone ? ` · ${member.timezone}` : ""}
        </span>
      </span>
      <Badge className="bg-muted text-muted-foreground">
        {member.actorType}
      </Badge>
      <Badge
        className={
          member.status === "active"
            ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
            : "bg-muted text-muted-foreground"
        }
      >
        {member.status}
      </Badge>
      <span
        className="w-24 text-right text-xs text-muted-foreground"
        title={capabilities.join(", ")}
      >
        {capabilities.length} caps
      </span>
      <span className="w-24 text-right text-xs text-muted-foreground">
        {member.lastActiveAt ? relativeTime(member.lastActiveAt) : "no activity"}
      </span>
      {member.status === "active" && member.actorType !== "system" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onDeactivate(member.id)}
        >
          Deactivate
        </Button>
      ) : null}
    </li>
  );
}

export function TeamsView() {
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [panel, setPanel] = useState<"none" | "human" | "agent">("none");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<{
    email: string;
    temporaryPassword: string;
  } | null>(null);
  const [humanForm, setHumanForm] = useState({
    email: "",
    displayName: "",
    jobTitle: "",
    team: "",
    role: "analyst",
    temporaryPassword: "",
  });
  const [agentForm, setAgentForm] = useState({
    name: "",
    slug: "",
    description: "",
    model: "configured",
    capabilityRequirements: "alerts.read, investigations.read, agents.read",
  });

  const directory = useDirectory(query.trim());
  const queryClient = useQueryClient();

  const visible = useMemo(() => {
    const entries = directory.data ?? [];
    if (showInactive) return entries;
    return entries.filter((e) => e.status === "active");
  }, [directory.data, showInactive]);

  const { groupedBy, groups } = useMemo(
    () => groupDirectory(visible),
    [visible],
  );
  const total = visible.length;
  const counts = useMemo(() => {
    return {
      humans: visible.filter((entry) => entry.actorType === "human").length,
      agents: visible.filter((entry) => entry.actorType === "agent").length,
    };
  }, [visible]);

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.directory(query.trim()),
    });
    await directory.refetch();
  }

  async function inviteHuman() {
    setBusy(true);
    setMessage(null);
    setInviteResult(null);
    try {
      const password =
        humanForm.temporaryPassword.trim() ||
        `MusterJoin!${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
      const response = await fetch("/api/v1/directory/humans", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: humanForm.email.trim(),
          displayName: humanForm.displayName.trim(),
          jobTitle: humanForm.jobTitle.trim() || undefined,
          team: humanForm.team.trim() || undefined,
          role: humanForm.role,
          temporaryPassword: password,
        }),
      });
      const body = (await response.json()) as {
        data?: { email: string; temporaryPassword: string };
        detail?: string;
      };
      if (!response.ok)
        throw new Error(body.detail ?? `Invite failed (${response.status})`);
      setInviteResult({
        email: body.data!.email,
        temporaryPassword: body.data!.temporaryPassword,
      });
      setMessage(`Invited ${body.data!.email}. Copy the temporary password now.`);
      setHumanForm({
        email: "",
        displayName: "",
        jobTitle: "",
        team: "",
        role: "analyst",
        temporaryPassword: "",
      });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  async function onboardAgent() {
    setBusy(true);
    setMessage(null);
    try {
      const caps = agentForm.capabilityRequirements
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const response = await fetch("/api/v1/agents", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: agentForm.name.trim(),
          slug: agentForm.slug.trim() || undefined,
          description: agentForm.description.trim(),
          model: agentForm.model.trim() || "configured",
          capabilityRequirements: caps,
        }),
      });
      const body = (await response.json()) as {
        data?: {
          id: string;
          name: string;
          nextSteps?: string[];
        };
        detail?: string;
      };
      if (!response.ok)
        throw new Error(body.detail ?? `Onboard failed (${response.status})`);
      setMessage(
        `Onboarded ${body.data!.name}. ${body.data!.nextSteps?.join(" ") ?? ""}`,
      );
      setAgentForm({
        name: "",
        slug: "",
        description: "",
        model: "configured",
        capabilityRequirements: "alerts.read, investigations.read, agents.read",
      });
      setPanel("none");
      await refresh();
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Onboard failed");
    } finally {
      setBusy(false);
    }
  }

  async function purgeDemo() {
    if (
      !confirm(
        "Deactivate demo humans (@yuma.example) and orphan agents without definitions? This cannot restore names automatically.",
      )
    )
      return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/directory/purge-demo", {
        method: "POST",
        credentials: "include",
      });
      const body = (await response.json()) as {
        data?: { deactivated: { displayName: string }[] };
        detail?: string;
      };
      if (!response.ok)
        throw new Error(body.detail ?? `Purge failed (${response.status})`);
      const names =
        body.data?.deactivated.map((d) => d.displayName).join(", ") || "none";
      setMessage(`Deactivated: ${names}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Purge failed");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(actorId: string) {
    if (!confirm("Deactivate this directory member?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/directory/${actorId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "inactive" }),
      });
      const body = (await response.json()) as { detail?: string };
      if (!response.ok)
        throw new Error(body.detail ?? `Deactivate failed (${response.status})`);
      setMessage("Member deactivated");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deactivate failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Workforce"
        title="Teams"
        description="Real organisation directory. Invite humans, onboard pack agents, and remove demo roster entries. Capability grants stay server-enforced."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                setPanel("human");
                setMessage(null);
              }}
            >
              Add human
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPanel("agent");
                setMessage(null);
              }}
            >
              Onboard agent
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void purgeDemo()}
            >
              Remove demo members
            </Button>
          </div>
        }
      />
      <PageBody>
        <div className="mb-4 rounded-md border border-border bg-[var(--color-paper)] p-3 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">How to staff this workspace</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            <li>
              <strong>Add human</strong> — creates a login + directory actor with a
              starter role (needs <code>administration.manage</code>).
            </li>
            <li>
              <strong>Onboard agent</strong> — creates a pack agent + definition
              (needs <code>agents.manage</code>). Then expose in Slack if required.
            </li>
            <li>
              <strong>Remove demo members</strong> — deactivates inactive{" "}
              <code>@yuma.example</code> humans and agents without definitions.
            </li>
          </ol>
        </div>

        {message ? (
          <p className="mb-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
            {message}
          </p>
        ) : null}

        {inviteResult ? (
          <div className="mb-3 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-soft)] p-3 text-sm">
            <p className="font-semibold">Temporary password (copy now)</p>
            <p className="mt-1 font-mono text-xs">
              {inviteResult.email} · {inviteResult.temporaryPassword}
            </p>
          </div>
        ) : null}

        {panel === "human" ? (
          <div className="mb-4 space-y-3 rounded-md border border-border bg-card p-4">
            <h2 className="font-display text-base font-bold">Invite human</h2>
            <div className="grid gap-3 tablet:grid-cols-2">
              <label className="block text-xs font-semibold">
                Email
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={humanForm.email}
                  onChange={(e) =>
                    setHumanForm((f) => ({ ...f, email: e.target.value }))
                  }
                  placeholder="analyst@example.com"
                />
              </label>
              <label className="block text-xs font-semibold">
                Display name
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={humanForm.displayName}
                  onChange={(e) =>
                    setHumanForm((f) => ({ ...f, displayName: e.target.value }))
                  }
                />
              </label>
              <label className="block text-xs font-semibold">
                Job title
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={humanForm.jobTitle}
                  onChange={(e) =>
                    setHumanForm((f) => ({ ...f, jobTitle: e.target.value }))
                  }
                />
              </label>
              <label className="block text-xs font-semibold">
                Team
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={humanForm.team}
                  onChange={(e) =>
                    setHumanForm((f) => ({ ...f, team: e.target.value }))
                  }
                  placeholder="SOC"
                />
              </label>
              <label className="block text-xs font-semibold">
                Role
                <select
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={humanForm.role}
                  onChange={(e) =>
                    setHumanForm((f) => ({ ...f, role: e.target.value }))
                  }
                >
                  <option value="analyst">analyst</option>
                  <option value="senior_analyst">senior_analyst</option>
                  <option value="incident_commander">incident_commander</option>
                  <option value="threat_hunter">threat_hunter</option>
                  <option value="detection_engineer">detection_engineer</option>
                  <option value="security_manager">security_manager</option>
                  <option value="administrator">administrator</option>
                  <option value="read_only">read_only</option>
                  <option value="auditor">auditor</option>
                </select>
              </label>
              <label className="block text-xs font-semibold">
                Temporary password (optional — auto if blank)
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm font-mono"
                  value={humanForm.temporaryPassword}
                  onChange={(e) =>
                    setHumanForm((f) => ({
                      ...f,
                      temporaryPassword: e.target.value,
                    }))
                  }
                  placeholder="min 12 chars"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void inviteHuman()}
              >
                Create login + directory entry
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPanel("none")}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {panel === "agent" ? (
          <div className="mb-4 space-y-3 rounded-md border border-border bg-card p-4">
            <h2 className="font-display text-base font-bold">Onboard pack agent</h2>
            <p className="text-xs text-muted-foreground">
              Creates an actor + agent definition. After save: open the agent
              profile, set Slack exposure if needed, then assign work from
              Operations.
            </p>
            <div className="grid gap-3 tablet:grid-cols-2">
              <label className="block text-xs font-semibold">
                Display name
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={agentForm.name}
                  onChange={(e) =>
                    setAgentForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="River"
                />
              </label>
              <label className="block text-xs font-semibold">
                Slug (optional)
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm font-mono"
                  value={agentForm.slug}
                  onChange={(e) =>
                    setAgentForm((f) => ({ ...f, slug: e.target.value }))
                  }
                  placeholder="river"
                />
              </label>
              <label className="block text-xs font-semibold tablet:col-span-2">
                Description
                <textarea
                  className="mt-1 min-h-16 w-full border bg-background px-3 py-2 text-sm"
                  value={agentForm.description}
                  onChange={(e) =>
                    setAgentForm((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder="What this agent is for"
                />
              </label>
              <label className="block text-xs font-semibold">
                Model label
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={agentForm.model}
                  onChange={(e) =>
                    setAgentForm((f) => ({ ...f, model: e.target.value }))
                  }
                />
              </label>
              <label className="block text-xs font-semibold">
                Capabilities (comma-separated)
                <input
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm font-mono"
                  value={agentForm.capabilityRequirements}
                  onChange={(e) =>
                    setAgentForm((f) => ({
                      ...f,
                      capabilityRequirements: e.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void onboardAgent()}
              >
                Create agent
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPanel("none")}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="team-search">
            Search directory
          </label>
          <input
            id="team-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people and agents"
            className="h-8 min-w-56 flex-1 rounded-md border border-border bg-background px-2 text-sm"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
          <span className="text-sm text-muted-foreground">
            {total} visible · {counts.humans} humans · {counts.agents} agents
          </span>
        </div>

        {directory.isError ? (
          <ErrorState
            error={directory.error}
            onRetry={() => {
              void directory.refetch();
            }}
          />
        ) : null}

        {directory.isLoading && total === 0 ? <SkeletonRows rows={5} /> : null}

        {!directory.isLoading && total === 0 && !directory.isError ? (
          <EmptyState
            title="No directory members visible"
            description="Invite a human or onboard an agent using the buttons above. Inactive members are hidden unless you tick Show inactive."
            action={
              <Button type="button" onClick={() => setPanel("human")}>
                Add your first human
              </Button>
            }
          />
        ) : null}

        {groups.map((group) => (
          <section
            key={group.key}
            className="rounded-md border border-border bg-card"
          >
            <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <h2 className="text-sm font-semibold">{group.label}</h2>
              <span className="text-sm text-muted-foreground">
                {group.members.length}{" "}
                {group.members.length === 1 ? "member" : "members"}
              </span>
            </header>
            <ul>
              {group.members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  busy={busy}
                  onDeactivate={(id) => void deactivate(id)}
                />
              ))}
            </ul>
          </section>
        ))}

        <p className="text-sm text-muted-foreground">
          {groupedBy === "actorType" && total > 0
            ? "Grouped by actor type (no team field set on members yet). Set a team when inviting to group by team."
            : "Team names come from the directory record."}{" "}
          Deactivate never hard-deletes — audit history stays intact.
        </p>
      </PageBody>
    </CompanyOsShell>
  );
}
