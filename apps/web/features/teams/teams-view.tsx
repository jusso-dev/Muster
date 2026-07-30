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

const UNASSIGNED = "Unassigned";

/**
 * Real organisation directory only. Actors without a team land in one
 * "Unassigned" group — never a synthetic SOC/IR roster.
 */
function groupByTeam(entries: DirectoryEntry[]) {
  const groups = new Map<string, DirectoryEntry[]>();
  for (const entry of entries) {
    const team = entry.team?.trim() || UNASSIGNED;
    const bucket = groups.get(team);
    if (bucket) bucket.push(entry);
    else groups.set(team, [entry]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) =>
      left === UNASSIGNED
        ? 1
        : right === UNASSIGNED
          ? -1
          : left.localeCompare(right),
    )
    .map(([team, members]) => ({
      team,
      members: members.sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
    }));
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
  const groups = useMemo(
    () => groupByTeam(directory.data ?? []),
    [directory.data],
  );
  const total = directory.data?.length ?? 0;
  const agents =
    directory.data?.filter((entry) => entry.actorType === "agent").length ?? 0;

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Workforce"
        title="Teams"
        description="Organisation-scoped humans and pack agents from the governed directory. No demo roster is seeded."
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
          <span className="text-xs text-muted-foreground">
            {total} members · {agents} agents · {total - agents} humans
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
            key={group.team}
            className="rounded-md border border-border bg-card"
          >
            <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <h2 className="text-sm font-semibold">{group.team}</h2>
              <span className="text-xs text-muted-foreground">
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

        <p className="text-xs text-muted-foreground">
          Team names come from the directory record. Capability grants stay
          server-enforced — this view never assigns or revokes anything.
        </p>
      </PageBody>
    </CompanyOsShell>
  );
}
