"use client";

import { useMemo, useState } from "react";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageBody } from "@/components/os/page-body";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuditEvents } from "@/lib/queries/hooks";
import { relativeTime } from "@/lib/utils";
import type { AuditEventSummary } from "@/types/os";

export function AuditView() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditEventSummary | null>(null);

  const filters = useMemo(
    () => ({
      q: q || undefined,
      action: action || undefined,
      targetType: targetType || undefined,
      limit: "50",
    }),
    [q, action, targetType],
  );

  const audit = useAuditEvents(filters);

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Govern"
        title="Audit & evidence"
        description="Organisation-scoped activity feed. Metadata is redacted and collapsed by default."
      />
      <PageBody>
        <form
          className="grid gap-2 rounded-md border border-border bg-card p-3 tablet:grid-cols-4"
          onSubmit={(event) => event.preventDefault()}
        >
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground" htmlFor="audit-q">
              Search
            </label>
            <input
              id="audit-q"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="action, target, trace…"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground" htmlFor="audit-action">
              Action
            </label>
            <input
              id="audit-action"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="exact action"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground" htmlFor="audit-target-type">
              Target type
            </label>
            <input
              id="audit-target-type"
              value={targetType}
              onChange={(event) => setTargetType(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="e.g. approval"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setQ("");
                setAction("");
                setTargetType("");
              }}
            >
              Clear filters
            </Button>
          </div>
        </form>

        {audit.isError ? (
          <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
        ) : null}
        {audit.isLoading ? <SkeletonRows rows={8} /> : null}

        {audit.data && audit.data.records.length === 0 ? (
          <EmptyState
            title="No audit events match"
            description="Adjust filters or wait for governed activity in this organisation."
          />
        ) : null}

        {audit.data && audit.data.records.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <caption className="sr-only">Audit events</caption>
                <thead className="border-b border-border bg-[var(--color-paper)] text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Actor</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Target</th>
                    <th className="px-3 py-2">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {audit.data.records.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setSelected(row)}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {relativeTime(row.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs font-medium">
                          {row.actorName ?? row.actorId.slice(0, 8)}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          {row.actorType}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.action}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {row.targetType}:{row.targetId.slice(0, 12)}
                      </td>
                      <td className="px-3 py-2">
                        {row.outcome ? (
                          <Badge className="bg-muted text-muted-foreground">
                            {row.outcome}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {audit.data.meta?.truncated ? (
                <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  Results truncated at limit {audit.data.meta.limit}.
                </p>
              ) : null}
            </div>

            <aside className="rounded-md border border-border bg-card p-3">
              <h2 className="text-sm font-semibold">Event detail</h2>
              {!selected ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Select a row to inspect metadata safely.
                </p>
              ) : (
                <div className="mt-3 space-y-2 text-xs">
                  <p>
                    <span className="text-muted-foreground">Time · </span>
                    <span className="font-mono">
                      {new Date(selected.createdAt).toISOString()}
                    </span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Trace · </span>
                    <span className="font-mono">{selected.traceId}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Seq · </span>
                    <span className="font-mono">{selected.sequence}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">IP · </span>
                    <span className="font-mono">
                      {selected.ipAddress ?? "—"}
                    </span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Hash · </span>
                    <span className="break-all font-mono text-xs">
                      {selected.eventHash}
                    </span>
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setExpandedId(
                        expandedId === selected.id ? null : selected.id,
                      )
                    }
                  >
                    {expandedId === selected.id
                      ? "Hide structured metadata"
                      : "Show structured metadata"}
                  </Button>
                  {expandedId === selected.id ? (
                    <pre className="max-h-64 overflow-auto rounded-md border border-border bg-[var(--color-paper)] p-2 font-mono text-xs leading-relaxed">
                      {JSON.stringify(selected.metadata, null, 2)}
                    </pre>
                  ) : null}
                </div>
              )}
            </aside>
          </div>
        ) : null}
      </PageBody>
    </CompanyOsShell>
  );
}
