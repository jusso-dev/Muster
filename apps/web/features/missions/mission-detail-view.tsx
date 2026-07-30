"use client";

import Link from "next/link";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { PackHandoffTimeline } from "@/components/os/pack-handoff-timeline";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { useMission, useMissionRuns } from "@/lib/queries/hooks";
import { relativeTime } from "@/lib/utils";

export function MissionDetailView({ missionId }: { missionId: string }) {
  const mission = useMission(missionId);
  const runs = useMissionRuns(missionId);

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Mission"
        title={mission.data?.name ?? "Mission detail"}
        description={
          mission.data?.description ||
          "Definition vs run history — invocations remain separate."
        }
        actions={
          <Link
            href="/missions"
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            ← Missions
          </Link>
        }
      />
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 tablet:p-5">
        {mission.isError ? (
          <ErrorState error={mission.error} onRetry={() => void mission.refetch()} />
        ) : null}
        {mission.isLoading ? <SkeletonRows rows={4} /> : null}
        {mission.data ? (
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Definition</h2>
            <dl className="mt-3 grid gap-3 text-sm tablet:grid-cols-2">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Status</dt>
                <dd>
                  <Badge className="bg-muted text-muted-foreground">
                    {mission.data.status}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">
                  Kill switch
                </dt>
                <dd>{mission.data.killSwitch ? "Engaged" : "Off"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">
                  Capability envelope
                </dt>
                <dd className="font-mono text-xs">
                  {mission.data.capabilityEnvelope.join(", ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">
                  Hermes profile
                </dt>
                <dd className="font-mono text-xs">
                  {mission.data.hermesProfile ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">
                  Schedule hint
                </dt>
                <dd>{mission.data.scheduleHint ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Id</dt>
                <dd className="break-all font-mono text-xs">{mission.data.id}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="rounded-md border border-border bg-card">
          <div className="border-b border-border px-4 py-2">
            <h2 className="text-sm font-semibold">Run history</h2>
          </div>
          {runs.isError ? (
            <div className="p-4">
              <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
            </div>
          ) : null}
          {runs.isLoading ? (
            <div className="p-4">
              <SkeletonRows rows={3} />
            </div>
          ) : null}
          {runs.data && runs.data.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No runs yet"
                description="Accepted mission runs appear here with status and errors."
              />
            </div>
          ) : null}
          {runs.data && runs.data.length > 0 ? (
            <ul className="divide-y divide-border">
              {runs.data.map((run) => (
                <li key={run.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-muted text-muted-foreground">
                      {run.status}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {run.id}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(run.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    idempotency {run.idempotencyKey}
                  </p>
                  {run.error ? (
                    <p className="mt-1 text-xs text-[var(--color-error)]">
                      {run.error}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <PackHandoffTimeline missionId={missionId} />
      </div>
    </CompanyOsShell>
  );
}
