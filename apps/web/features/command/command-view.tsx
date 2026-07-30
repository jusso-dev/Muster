"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity,
  Bot,
  Cable,
  CircleCheck,
  ClipboardList,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import type { ComponentType } from "react";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import {
  RUN_ACTIVITY_SERIES,
  RunActivityChart,
  STATUS_SLICE_COLOURS,
  StatusDonut,
  type RunActivitySeriesKey,
} from "@/components/os/charts";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { MetricTile } from "@/components/os/metric-tile";
import { Panel, PanelLink } from "@/components/os/panel";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageBody } from "@/components/os/page-body";
import { PageHeader } from "@/components/page-header";
import {
  HealthBadge,
  OperationalStateBadge,
  SeverityBadge,
} from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useCommandSummary } from "@/lib/queries/hooks";
import { cn, relativeTime } from "@/lib/utils";
import type { AttentionItem, MyTaskRow } from "@/types/os";

/** Attention items arrive typed; the icon states the kind before the words do. */
const ATTENTION_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  pending_approval: CircleCheck,
  failed_mission: Activity,
  agent_kill_switch: ShieldAlert,
  failed_agent_invocation: Bot,
  blocked_pack_handoff: ClipboardList,
  pending_pack_handoff: ClipboardList,
  unhealthy_connector: Cable,
};

function RowIcon({
  icon: Icon,
  tone = "muted",
}: {
  icon: ComponentType<{ className?: string }>;
  tone?: "muted" | "accent" | "agent" | "warning" | "danger";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md border border-border",
        tone === "accent" && "active-indicator border-transparent",
        tone === "agent" && "agent-surface border-transparent",
        tone === "warning" &&
          "approval-surface border-transparent text-[var(--color-warning)]",
        tone === "danger" &&
          "error-surface border-transparent text-[var(--color-error)]",
        tone === "muted" && "bg-[var(--color-paper-3)] text-muted-foreground",
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const Icon = ATTENTION_ICONS[item.type] ?? Activity;
  const tone =
    item.severity === "critical" || item.severity === "high"
      ? "danger"
      : item.severity === "medium"
        ? "warning"
        : "muted";

  return (
    <article className="flex items-start gap-3 px-4 py-3 hover-row">
      <RowIcon icon={Icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 text-sm font-semibold">
            {item.href ? (
              <Link href={item.href} className="hover:underline">
                {item.title}
              </Link>
            ) : (
              item.title
            )}
          </h3>
          <Badge className="bg-muted text-muted-foreground">
            {item.type.replaceAll("_", " ")}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {item.sourceSystem}
          {item.owner ? ` · ${item.owner}` : ""} · {item.age}
        </p>
        <p className="mt-1 text-xs">Next: {item.recommendedAction}</p>
      </div>
      <SeverityBadge severity={item.severity} compact />
    </article>
  );
}

function TaskRow({ task }: { task: MyTaskRow }) {
  return (
    <article className="flex items-center gap-3 px-4 py-2.5 hover-row">
      <RowIcon icon={ClipboardList} tone="muted" />
      <div className="min-w-0 flex-1">
        <Link
          href={`/operations?task=${task.id}`}
          className="block truncate text-sm font-medium hover:underline"
        >
          {task.title}
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {task.priority} priority
          {task.dueAt ? ` · due ${relativeTime(task.dueAt)}` : ""} ·{" "}
          {relativeTime(task.updatedAt)}
        </p>
      </div>
      <OperationalStateBadge state={task.status} />
    </article>
  );
}

export function CommandView() {
  const query = useCommandSummary();
  const [visibleSeries, setVisibleSeries] = useState<RunActivitySeriesKey[]>([
    "completed",
    "running",
    "failed",
    "cancelled",
  ]);
  const [taskTab, setTaskTab] = useState<"mine" | "unassigned">("mine");

  const data = query.data;
  const taskStatus = data?.taskStatus ?? [];
  const taskTotal = taskStatus.reduce((sum, slice) => sum + slice.count, 0);
  const runTotal = (data?.runActivity ?? []).reduce(
    (sum, point) =>
      sum + point.completed + point.failed + point.running + point.cancelled,
    0,
  );
  const myTasks = data?.myTasks ?? [];
  const assignedToMe = myTasks.filter((task) => task.assignedToMe);
  const unassigned = myTasks.filter((task) => !task.assignedToMe);
  const shownTasks = taskTab === "mine" ? assignedToMe : unassigned;

  function toggleSeries(key: RunActivitySeriesKey) {
    setVisibleSeries((current) =>
      current.includes(key)
        ? current.length > 1
          ? current.filter((entry) => entry !== key)
          : current
        : [...current, key],
    );
  }

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Operate"
        title="Command"
        description="What needs attention now across operations, agents, approvals, and integrations."
        actions={
          <>
            {data ? (
              <span className="text-xs text-muted-foreground">
                Updated {relativeTime(data.generatedAt)}
              </span>
            ) : null}
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
            <Link
              href="/operations"
              className={buttonVariants({ size: "sm" })}
            >
              New work item
            </Link>
          </>
        }
      />
      <PageBody width="full">
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : null}

        {query.isLoading ? <SkeletonRows rows={6} /> : null}

        {data ? (
          <>
            {data.notes.length > 0 ? (
              <p className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
                {data.notes.join(" · ")}
              </p>
            ) : null}

            <section aria-labelledby="command-metrics">
              <h2 id="command-metrics" className="sr-only">
                Top metrics
              </h2>
              <div className="grid gap-3 tablet:grid-cols-2 desktop:grid-cols-3 wide:grid-cols-5">
                {data.metrics.map((metric) => (
                  <MetricTile key={metric.id} metric={metric} />
                ))}
              </div>
            </section>

            <div className="grid gap-4 desktop:grid-cols-2 wide:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
              <Panel
                title="Agent run activity"
                description="Runs started per hour, last 24 hours."
                bodyClassName="px-4 pb-4"
                action={
                  <div
                    className="flex flex-wrap gap-1"
                    role="group"
                    aria-label="Toggle run series"
                  >
                    {RUN_ACTIVITY_SERIES.map((series) => {
                      const on = visibleSeries.includes(series.key);
                      return (
                        <button
                          key={series.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleSeries(series.key)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                            on
                              ? "border-border bg-[var(--color-paper-3)] text-foreground"
                              : "border-transparent text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <span
                            aria-hidden
                            className="size-2 rounded-full"
                            style={{
                              background: on ? series.colour : "var(--color-rule-strong)",
                            }}
                          />
                          {series.label}
                        </button>
                      );
                    })}
                  </div>
                }
              >
                {runTotal === 0 ? (
                  <EmptyState
                    title="No agent runs in the last 24 hours"
                    description="Dispatch work to an agent from Operations and its runs appear here."
                  />
                ) : (
                  <RunActivityChart
                    data={data.runActivity}
                    visible={visibleSeries}
                  />
                )}
              </Panel>

              <Panel
                title="Work by status"
                description="Every work item that is not archived."
                bodyClassName="px-4 pb-4"
              >
                {taskTotal === 0 ? (
                  <EmptyState
                    title="No work items yet"
                    description="Statuses appear here once work exists in this organisation."
                  />
                ) : (
                  <>
                    <StatusDonut
                      slices={taskStatus}
                      total={taskTotal}
                      totalLabel="Work items"
                    />
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {taskStatus.map((slice) => (
                        <li
                          key={slice.status}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{
                              background:
                                STATUS_SLICE_COLOURS[slice.status] ??
                                "var(--color-muted)",
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {slice.label}
                          </span>
                          <span className="font-mono tabular-nums">
                            {slice.count}
                          </span>
                          <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">
                            {Math.round((slice.count / taskTotal) * 100)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Panel>

              <Panel
                title="Work queue"
                description="Open items you own, and the ones nobody owns yet."
                bodyClassName="pb-2"
                action={<PanelLink href="/operations">View all</PanelLink>}
              >
                <div
                  role="tablist"
                  aria-label="Work queue filter"
                  className="mx-4 mb-1 flex gap-1 border-b border-border"
                >
                  {(
                    [
                      ["mine", "Assigned to me", assignedToMe.length],
                      ["unassigned", "Unassigned", unassigned.length],
                    ] as const
                  ).map(([key, label, total]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={taskTab === key}
                      onClick={() => setTaskTab(key)}
                      className={cn(
                        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-2 py-2 text-sm font-medium transition-colors",
                        taskTab === key
                          ? "border-[var(--color-accent)] text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                      <Badge className="bg-muted text-muted-foreground">
                        {total}
                      </Badge>
                    </button>
                  ))}
                </div>
                {shownTasks.length === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      title={
                        taskTab === "mine"
                          ? "Nothing assigned to you"
                          : "Everything open has an owner"
                      }
                      description="Open work items appear here as they are created and assigned."
                    />
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {shownTasks.slice(0, 6).map((task) => (
                      <TaskRow key={task.id} task={task} />
                    ))}
                  </div>
                )}
              </Panel>
            </div>

            <div className="grid gap-4 desktop:grid-cols-2 wide:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
              <Panel
                title="Attention queue"
                description="Pending approvals, failed runs, stalled handoffs, and degraded connectors."
                action={
                  <Badge className="bg-muted text-muted-foreground">
                    {data.attention.length}
                  </Badge>
                }
              >
                {data.attention.length === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      title="Nothing needs attention"
                      description="Pending approvals, failed runs, and degraded connectors appear here."
                    />
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {data.attention.slice(0, 6).map((item) => (
                      <AttentionRow key={item.id} item={item} />
                    ))}
                  </div>
                )}
              </Panel>

              <Panel
                title="Agent activity"
                description="Runs and success rate over the last 7 days."
                action={<PanelLink href="/agents">View all</PanelLink>}
              >
                {data.agentActivity.length === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      title="No agents visible"
                      description="Agents you are authorised to see appear here with their run history."
                    />
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {data.agentActivity.map((agent) => (
                      <div
                        key={agent.id}
                        className="flex items-center gap-3 px-4 py-2.5 hover-row"
                      >
                        <RowIcon icon={Bot} tone="agent" />
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/agents/${agent.id}`}
                            className="block truncate text-sm font-medium hover:underline"
                          >
                            {agent.name}
                          </Link>
                          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                            {agent.runtime} · {agent.status}
                          </p>
                        </div>
                        <div className="w-24 shrink-0 text-right">
                          <p className="font-mono text-sm tabular-nums">
                            {agent.runs}
                            <span className="ml-1 text-xs text-muted-foreground">
                              runs
                            </span>
                          </p>
                          {agent.successRate === null ? (
                            <p className="text-xs text-muted-foreground">
                              No settled runs
                            </p>
                          ) : (
                            <>
                              <p className="text-xs text-muted-foreground">
                                {Math.round(agent.successRate * 100)}% success
                              </p>
                              <Progress
                                className="mt-1"
                                value={agent.successRate * 100}
                                label={`${agent.name} success rate`}
                                tone={
                                  agent.successRate >= 0.9
                                    ? "success"
                                    : agent.successRate >= 0.6
                                      ? "warning"
                                      : "error"
                                }
                              />
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel
                title="Recent activity"
                description="The organisation's audit trail, newest first."
                action={<PanelLink href="/audit">Full audit</PanelLink>}
              >
                {data.activity.length === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      title="No recent audit events"
                      description="Either nothing has happened yet, or this session is not authorised to read the audit trail."
                    />
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.activity.slice(0, 7).map((event) => (
                      <li
                        key={event.id}
                        className="flex items-start gap-3 px-4 py-2.5 hover-row"
                      >
                        <span
                          aria-hidden
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--color-rule-strong)]"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            <span className="font-medium">{event.actor}</span>{" "}
                            <span className="text-muted-foreground">
                              {event.action}
                            </span>
                          </p>
                          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                            {event.target}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {relativeTime(event.timestamp)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <Panel
              title="Integrations health"
              description="Control-plane components behind this organisation."
              bodyClassName="px-4 pb-4"
              action={<PanelLink href="/integrations">View all</PanelLink>}
            >
              {data.integrations.length === 0 ? (
                <EmptyState
                  title="Control-plane status not available"
                  description="Reading component health requires administration.manage."
                />
              ) : (
                <ul className="grid gap-2 tablet:grid-cols-2 wide:grid-cols-4">
                  {data.integrations.map((integration) => (
                    <li
                      key={integration.id}
                      className="flex items-center gap-3 rounded-md border border-border bg-[var(--color-paper-3)] px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {integration.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {integration.detail}
                        </p>
                      </div>
                      <HealthBadge health={integration.health} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Operational risk radar"
              description="Heuristic summaries from live counts — not a composite score."
              bodyClassName="px-4 pb-4"
            >
              <ul className="grid gap-2 tablet:grid-cols-2 desktop:grid-cols-3 wide:grid-cols-5">
                {data.riskRadar.map((cell) => (
                  <li
                    key={cell.id}
                    className="rounded-md border border-border bg-[var(--color-paper-3)] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {cell.label}
                      </span>
                      <HealthBadge health={cell.health} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {cell.summary}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          </>
        ) : null}
      </PageBody>
    </CompanyOsShell>
  );
}
