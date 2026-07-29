"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { MetricTile } from "@/components/os/metric-tile";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageHeader } from "@/components/page-header";
import { HealthBadge, SeverityBadge } from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCommandSummary } from "@/lib/queries/hooks";
import { relativeTime } from "@/lib/utils";

export function CommandView() {
  const query = useCommandSummary();

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Security Company OS"
        title="Command"
        description="What needs attention now across operations, agents, approvals, and integrations."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw
              className={`size-4 ${query.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        }
      />
      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 tablet:p-5">
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : null}

        {query.isLoading ? <SkeletonRows rows={6} /> : null}

        {query.data ? (
          <>
            {query.data.notes.length > 0 ? (
              <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
                {query.data.notes.join(" · ")}
              </div>
            ) : null}

            <section aria-labelledby="command-metrics">
              <h2 id="command-metrics" className="sr-only">
                Top metrics
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {query.data.metrics.map((metric) => (
                  <MetricTile key={metric.id} metric={metric} />
                ))}
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <section
                aria-labelledby="attention-heading"
                className="rounded-md border border-border bg-card"
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 id="attention-heading" className="text-sm font-semibold">
                    Attention queue
                  </h2>
                  <Badge className="bg-muted text-muted-foreground">
                    {query.data.attention.length}
                  </Badge>
                </div>
                <div className="divide-y divide-border">
                  {query.data.attention.length === 0 ? (
                    <div className="p-4">
                      <EmptyState
                        title="Nothing needs attention"
                        description="Pending approvals, failed runs, and degraded connectors appear here."
                      />
                    </div>
                  ) : (
                    query.data.attention.map((item) => (
                      <article key={item.id} className="px-3 py-3">
                        <div className="flex flex-wrap items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-semibold">
                                {item.href ? (
                                  <Link
                                    href={item.href}
                                    className="hover:underline"
                                  >
                                    {item.title}
                                  </Link>
                                ) : (
                                  item.title
                                )}
                              </h3>
                              <SeverityBadge severity={item.severity} />
                              <Badge className="bg-muted text-muted-foreground">
                                {item.type.replaceAll("_", " ")}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.sourceSystem}
                              {item.owner ? ` · ${item.owner}` : ""} · {item.age}
                            </p>
                            <p className="mt-1 text-xs">
                              Next: {item.recommendedAction}
                            </p>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>

              <section
                aria-labelledby="radar-heading"
                className="rounded-md border border-border bg-card"
              >
                <div className="border-b border-border px-3 py-2">
                  <h2 id="radar-heading" className="text-sm font-semibold">
                    Operational risk radar
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Heuristic summaries from live counts — not a composite score.
                  </p>
                </div>
                <ul className="grid gap-2 p-3 sm:grid-cols-2">
                  {query.data.riskRadar.map((cell) => (
                    <li
                      key={cell.id}
                      className="rounded-md border border-border bg-[var(--color-paper)] p-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold">{cell.label}</span>
                        <HealthBadge health={cell.health} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {cell.summary}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section
                aria-labelledby="agents-heading"
                className="rounded-md border border-border bg-card"
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 id="agents-heading" className="text-sm font-semibold">
                    Agent status
                  </h2>
                  <Link
                    href="/agents"
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    View all
                  </Link>
                </div>
                <div className="divide-y divide-border">
                  {query.data.agents.length === 0 ? (
                    <p className="p-4 text-xs text-muted-foreground">
                      No agents visible for this session.
                    </p>
                  ) : (
                    query.data.agents.map((agent) => (
                      <div
                        key={agent.id}
                        className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                      >
                        <Link
                          href={`/agents/${agent.id}`}
                          className="min-w-0 flex-1 font-medium hover:underline"
                        >
                          {agent.name}
                        </Link>
                        <Badge className="bg-muted text-muted-foreground">
                          {agent.status}
                        </Badge>
                        <span className="font-mono text-xs text-muted-foreground">
                          {agent.runtime}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {agent.lastRunStatus
                            ? `${agent.lastRunStatus}${
                                agent.lastRunAt
                                  ? ` · ${relativeTime(agent.lastRunAt)}`
                                  : ""
                              }`
                            : "No recent run"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section
                aria-labelledby="activity-heading"
                className="rounded-md border border-border bg-card"
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 id="activity-heading" className="text-sm font-semibold">
                    Live activity
                  </h2>
                  <Link
                    href="/audit"
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Full audit
                  </Link>
                </div>
                <div className="divide-y divide-border">
                  {query.data.activity.length === 0 ? (
                    <p className="p-4 text-xs text-muted-foreground">
                      No recent audit events (or not authorised).
                    </p>
                  ) : (
                    query.data.activity.map((event) => (
                      <div key={event.id} className="px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {relativeTime(event.timestamp)}
                          </span>
                          <span className="font-medium">{event.actor}</span>
                          <span className="text-muted-foreground">
                            {event.action}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                          {event.target}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </CompanyOsShell>
  );
}
