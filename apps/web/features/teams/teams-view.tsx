"use client";

import { useMemo, useState } from "react";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageBody } from "@/components/os/page-body";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { useDirectory, type DirectoryEntry } from "@/lib/queries/hooks";
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

/**
 * Real organisation directory only — never a synthetic SOC/IR roster.
 *
 * `team` is a nullable column no product surface writes yet, so grouping by it
 * normally collapses the whole organisation into one meaningless bucket. Group
 * by team only once the directory actually returns one; otherwise fall back to
 * actor type, which is always populated and is the distinction that matters
 * today.
 */
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

function MemberRow({ member }: { member: DirectoryEntry }) {
  const capabilities = member.capabilityAssignments ?? [];
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 last:border-b-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {member.displayName}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {member.jobTitle ?? (member.actorType === "agent" ? "Pack agent" : "—")}
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
    </li>
  );
}

export function TeamsView() {
  const [query, setQuery] = useState("");
  const directory = useDirectory(query.trim());
  const { groupedBy, groups } = useMemo(
    () => groupDirectory(directory.data ?? []),
    [directory.data],
  );
  const total = directory.data?.length ?? 0;
  // Counted per actor type rather than subtracted, so system actors are never
  // reported as humans.
  const counts = useMemo(() => {
    const entries = directory.data ?? [];
    return {
      humans: entries.filter((entry) => entry.actorType === "human").length,
      agents: entries.filter((entry) => entry.actorType === "agent").length,
    };
  }, [directory.data]);

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Workforce"
        title="Teams"
        description="The governed directory of organisation-scoped humans and pack agents. Grouped by team where the directory records one, by actor type where it does not. No demo roster is seeded."
      />
      <PageBody>
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
          <span className="text-sm text-muted-foreground">
            {total} members · {counts.humans} humans · {counts.agents} agents
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
            description="The governed directory returned no organisation-scoped actors for this session. Membership is server-controlled; nothing is invented here."
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
                <MemberRow key={member.id} member={member} />
              ))}
            </ul>
          </section>
        ))}

        <p className="text-sm text-muted-foreground">
          {groupedBy === "actorType" && total > 0
            ? "No directory entry carries a team, so this is grouped by actor type. Team names are read straight off the directory record; nothing here invents one."
            : "Team names are read straight off the directory record; nothing here invents one."}{" "}
          Capability grants stay server-enforced — this view never assigns or
          revokes anything.
        </p>
      </PageBody>
    </CompanyOsShell>
  );
}
