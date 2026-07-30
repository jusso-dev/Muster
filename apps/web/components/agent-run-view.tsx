"use client";

import { useQuery } from "@tanstack/react-query";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { AgentRunResult } from "@/components/os/agent-run-result";
import { ErrorState } from "@/components/os/error-state";
import { PageBody } from "@/components/os/page-body";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api/client";
import { relativeTime } from "@/lib/utils";

type RunTimeline = {
  runId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  failureCode: string | null;
  error: string | null;
  cancellationReason: string | null;
  structuredOutput: unknown;
  outputHash: string | null;
  events: Array<{
    id: string;
    eventType: string;
    message: string;
    createdAt: string;
  }>;
};

const IN_FLIGHT = [
  "queued",
  "running",
  "awaiting_approval",
  "waiting_sources",
];

export function AgentRunView({ runId }: { runId: string }) {
  const run = useQuery({
    queryKey: ["agent-run", runId, "timeline"],
    queryFn: async () => {
      const res = await apiGet<RunTimeline>(
        `/api/v1/agent-runs/${encodeURIComponent(runId)}/timeline`,
      );
      return res.data;
    },
    // A run settles in the gateway, not the browser, so poll until it stops.
    refetchInterval: (query) =>
      IN_FLIGHT.includes(query.state.data?.status ?? "") ? 10_000 : false,
  });

  const data = run.data;

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Workforce"
        title="Agent run"
        description="Authoritative run status, execution timeline, and typed result."
      />
      <PageBody>
        {run.isError ? (
          <ErrorState error={run.error} onRetry={() => void run.refetch()} />
        ) : null}
        {run.isLoading ? <SkeletonRows rows={4} /> : null}

        {data ? (
          <>
            <section className="rounded-md border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">Run</h2>
                <Badge className="bg-muted text-muted-foreground">
                  {data.status}
                </Badge>
                {data.failureCode ? (
                  <Badge className="bg-[var(--color-error-soft)] text-[var(--color-error)]">
                    {data.failureCode}
                  </Badge>
                ) : null}
              </div>
              <dl className="mt-3 grid gap-3 text-sm tablet:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    Run id
                  </dt>
                  <dd className="mt-0.5 break-all font-mono text-xs">
                    {data.runId}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    Started
                  </dt>
                  <dd className="mt-0.5">
                    {data.startedAt ? relativeTime(data.startedAt) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    Completed
                  </dt>
                  <dd className="mt-0.5">
                    {data.completedAt ? relativeTime(data.completedAt) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-muted-foreground">
                    Events
                  </dt>
                  <dd className="mt-0.5">{data.events.length}</dd>
                </div>
              </dl>
            </section>

            <AgentRunResult
              run={{
                runId: data.runId,
                status: data.status,
                structuredOutput: data.structuredOutput,
                error: data.error,
                cancellationReason: data.cancellationReason,
                outputHash: data.outputHash,
              }}
              showFullRunLink={false}
            />

            <section className="rounded-md border border-border bg-card">
              <header className="border-b border-border px-3 py-2">
                <h2 className="text-sm font-semibold">Execution timeline</h2>
              </header>
              {data.events.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  No execution events were recorded for this run.
                </p>
              ) : (
                <ol>
                  {data.events.map((event) => (
                    <li
                      key={event.id}
                      className="border-b border-border px-3 py-2 last:border-b-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-muted font-mono text-muted-foreground">
                          {event.eventType}
                        </Badge>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {relativeTime(event.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {event.message}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        ) : null}
      </PageBody>
    </CompanyOsShell>
  );
}
