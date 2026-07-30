"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { PackHandoffTimeline } from "@/components/os/pack-handoff-timeline";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageBody } from "@/components/os/page-body";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { useMission, useMissionRuns } from "@/lib/queries/hooks";
import { relativeTime } from "@/lib/utils";

type Revision = {
  id: string;
  revision: number;
  changeSummary: string;
  createdAt: string;
  snapshot: unknown;
};

export function MissionDetailView({ missionId }: { missionId: string }) {
  const mission = useMission(missionId);
  const runs = useMissionRuns(missionId);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [revError, setRevError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/missions/${missionId}/revisions`,
          { credentials: "include" },
        );
        const body = (await response.json()) as {
          data?: Revision[];
          detail?: string;
        };
        if (!response.ok)
          throw new Error(body.detail ?? `HTTP ${response.status}`);
        if (!cancelled) setRevisions(body.data ?? []);
      } catch (error) {
        if (!cancelled)
          setRevError(
            error instanceof Error ? error.message : "Failed to load revisions",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionId]);


  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Operate"
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
      <PageBody>
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
                <dt className="text-xs uppercase text-muted-foreground">
                  Revision
                </dt>
                <dd className="font-mono text-xs">
                  v{mission.data.revision ?? 1}
                </dd>
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
            <h2 className="text-sm font-semibold">Version history</h2>
          </div>
          {revError ? (
            <p className="p-4 text-sm text-[var(--color-error)]">{revError}</p>
          ) : null}
          {revisions.length === 0 && !revError ? (
            <div className="p-4">
              <EmptyState
                title="No revisions stored yet"
                description="Edits from the Missions UI write a revision snapshot. Older rows created before versioning may only show the current definition."
              />
            </div>
          ) : null}
          {revisions.length > 0 ? (
            <ul className="divide-y divide-border">
              {revisions.map((rev) => (
                <li key={rev.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-muted text-muted-foreground">
                      v{rev.revision}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(rev.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs">{rev.changeSummary || "—"}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

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
                    <span className="text-sm text-muted-foreground">
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
      </PageBody>
    </CompanyOsShell>
  );
}
