"use client";

import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { FIXTURE_TEAMS } from "@/lib/api/fixtures/teams";

export function TeamsView() {
  const teams = FIXTURE_TEAMS;

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Workforce"
        title="Teams"
        description="Human and agent workforce structure. Fixture-backed until team membership is first-class in the API."
      />
      <div className="mx-auto max-w-6xl p-4 tablet:p-5">
        <div className="mb-3 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning-soft)] px-3 py-2 text-xs">
          Showing development fixtures (`source: fixture`). Organisation-owned
          team APIs are not implemented yet — do not treat these as live roster.
        </div>
        {teams.length === 0 ? (
          <EmptyState title="No teams" />
        ) : (
          <div className="grid gap-3 tablet:grid-cols-2 wide:grid-cols-3">
            {teams.map((team) => (
              <article
                key={team.id}
                className="rounded-md border border-border bg-card p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold">{team.name}</h2>
                  <Badge className="bg-muted text-muted-foreground">
                    fixture
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {team.purpose}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Humans</dt>
                    <dd className="font-semibold tabular-nums">
                      {team.memberCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Agents</dt>
                    <dd className="font-semibold tabular-nums">
                      {team.agentCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Active missions</dt>
                    <dd className="font-semibold tabular-nums">
                      {team.activeMissions}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Workload</dt>
                    <dd className="font-semibold tabular-nums">{team.workload}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </div>
    </CompanyOsShell>
  );
}
