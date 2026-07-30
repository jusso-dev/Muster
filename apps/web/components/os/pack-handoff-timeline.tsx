"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { usePackHandoffs, type PackHandoffRow } from "@/lib/queries/hooks";
import { relativeTime } from "@/lib/utils";

const statusTone: Record<string, string> = {
  blocked: "bg-[var(--color-error-soft)] text-[var(--color-error)]",
  rejected: "bg-[var(--color-error-soft)] text-[var(--color-error)]",
  awaiting_approval:
    "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  dispatched: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
};

function HandoffEntry({ handoff }: { handoff: PackHandoffRow }) {
  return (
    <li className="border-b border-border px-3 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {handoff.fromAgent} → {handoff.toAgent}
        </span>
        <Badge className="bg-muted text-muted-foreground">
          {handoff.reason}
        </Badge>
        <Badge
          className={statusTone[handoff.status] ?? "bg-muted text-muted-foreground"}
        >
          {handoff.status.replace("_", " ")}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {relativeTime(handoff.createdAt)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{handoff.summary}</p>
      {handoff.blockedReason ? (
        <p className="mt-1 text-xs text-[var(--color-error)]">
          {handoff.blockedReason}
        </p>
      ) : null}
      {handoff.requestedCapabilities.length > 0 ? (
        <p className="mt-1 flex flex-wrap gap-1">
          {handoff.requestedCapabilities.map((capability) => (
            <Badge
              key={capability}
              className="bg-muted font-mono text-xs text-muted-foreground"
            >
              {capability}
            </Badge>
          ))}
        </p>
      ) : null}
      {handoff.status === "awaiting_approval" ? (
        <Link
          href="/approvals"
          className="mt-1 inline-block text-xs font-semibold underline"
        >
          Open approval
        </Link>
      ) : null}
    </li>
  );
}

/**
 * Read-only handoff history for a work item. Requesting a handoff is an agent
 * action through the harness or MCP — the OS shows it, it never starts one.
 */
export function PackHandoffTimeline({
  taskId,
  missionId,
  roomId,
}: {
  taskId?: string;
  missionId?: string;
  roomId?: string;
}) {
  const handoffs = usePackHandoffs({
    ...(taskId ? { taskId } : {}),
    ...(missionId ? { missionId } : {}),
    ...(roomId ? { roomId } : {}),
  });
  const rows = handoffs.data ?? [];

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold">Pack handoffs</h3>
        <span className="text-sm text-muted-foreground">
          {rows.length} recorded
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          {handoffs.isLoading
            ? "Loading handoffs…"
            : "No pack handoff has been requested for this item."}
        </p>
      ) : (
        <ul>
          {rows.map((handoff) => (
            <HandoffEntry key={handoff.id} handoff={handoff} />
          ))}
        </ul>
      )}
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        Handoff briefs travel to the target agent as untrusted evidence, never
        as instructions.
      </p>
    </section>
  );
}
