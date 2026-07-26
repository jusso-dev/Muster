"use client";

import { useEffect, useState } from "react";
import {
  Ban,
  CheckCircle2,
  Clock3,
  ExternalLink,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  AgentHandoff,
  AgentHandoffDisposition,
} from "@/lib/agent-handoff-domain";
import { cn } from "@/lib/utils";

type RunTimeline = {
  runId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  events: Array<{
    id: string;
    eventType: string;
    message: string;
    createdAt: string;
  }>;
};

const dispositionLabels: Record<AgentHandoffDisposition, string> = {
  completed: "Completed",
  partial: "Partially completed",
  failed: "Failed",
  cancelled: "Cancelled",
  blocked: "Blocked",
};

function dispositionClass(disposition: AgentHandoffDisposition): string {
  if (disposition === "completed") {
    return "success-surface text-[var(--color-success)]";
  }
  if (disposition === "partial" || disposition === "blocked") {
    return "approval-surface text-[var(--color-warning)]";
  }
  return "error-surface text-[var(--color-error)]";
}

function DispositionIcon({
  disposition,
}: {
  disposition: AgentHandoffDisposition;
}) {
  if (disposition === "completed") return <CheckCircle2 />;
  if (disposition === "partial" || disposition === "blocked") {
    return <ShieldAlert />;
  }
  if (disposition === "cancelled") return <Ban />;
  return <XCircle />;
}

export function AgentHandoffCard({
  handoff,
  compact = false,
}: {
  handoff: AgentHandoff;
  compact?: boolean;
}) {
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timeline, setTimeline] = useState<RunTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!timelineOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTimelineOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [timelineOpen]);

  async function openTimeline() {
    setTimelineOpen(true);
    setTimeline(null);
    setError("");
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v1/agent-runs/${encodeURIComponent(handoff.runId)}/timeline`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Timeline unavailable");
      const payload = (await response.json()) as { data: RunTimeline };
      setTimeline(payload.data);
    } catch {
      setError("The append-only run timeline is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <article
        data-testid="agent-handoff-card"
        aria-label={`Agent handoff: ${dispositionLabels[handoff.disposition]}`}
        className={cn(
          "rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-paper-2)] p-3 text-xs",
          !compact && "mt-3",
        )}
      >
        <header className="flex flex-wrap items-center gap-2">
          <strong className="mr-auto text-sm">Agent handoff</strong>
          <Badge className={cn("gap-1", dispositionClass(handoff.disposition))}>
            <DispositionIcon disposition={handoff.disposition} />
            {dispositionLabels[handoff.disposition]}
          </Badge>
        </header>

        <dl className="mt-3 grid gap-2">
          <div>
            <dt className="font-semibold text-muted-foreground">
              Requested outcome
            </dt>
            <dd className="mt-0.5 break-words leading-5">
              {handoff.requestedOutcome}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-muted-foreground">Outcome</dt>
            <dd className="mt-0.5 break-words leading-5">{handoff.outcome}</dd>
          </div>
          <div>
            <dt className="font-semibold text-muted-foreground">
              Verification
            </dt>
            <dd className="mt-0.5 break-words leading-5">
              {handoff.verificationSummary}
            </dd>
          </div>
          {handoff.blocker && (
            <div>
              <dt className="font-semibold text-[var(--color-warning)]">
                Blocker
              </dt>
              <dd className="mt-0.5 break-words leading-5">
                {handoff.blocker}
              </dd>
            </div>
          )}
        </dl>

        {handoff.artifacts.length > 0 && (
          <div className="mt-3">
            <p className="font-semibold text-muted-foreground">
              Authorised evidence
            </p>
            <ul className="mt-1 space-y-1">
              {handoff.artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <a
                    href={artifact.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1 text-[var(--color-accent)] underline-offset-2 hover:underline"
                  >
                    <span className="truncate">{artifact.label}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2">
          <time className="flex items-center gap-1 text-muted-foreground">
            <Clock3 className="size-3" />
            Completed{" "}
            {new Date(handoff.completedAt).toLocaleString("en-AU", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void openTimeline()}
          >
            View full timeline
          </Button>
        </footer>
      </article>

      {timelineOpen && (
        <>
          <button
            type="button"
            aria-label="Close run timeline"
            className="fixed inset-0 z-50 bg-black/30"
            onClick={() => setTimelineOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Full agent run timeline"
            className="fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l bg-background shadow-xl tablet:w-[30rem]"
          >
            <header className="flex min-h-14 items-center gap-3 border-b px-4">
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-sm font-bold">
                  Full agent run timeline
                </h2>
                <p className="truncate text-xs text-muted-foreground">
                  Append-only run {handoff.runId}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close full agent run timeline"
                onClick={() => setTimelineOpen(false)}
              >
                <X />
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loading && (
                <p className="text-sm text-muted-foreground">
                  Loading append-only timeline…
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {timeline && timeline.events.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No persisted run events were recorded.
                </p>
              )}
              {timeline && timeline.events.length > 0 && (
                <ol className="space-y-3">
                  {timeline.events.map((event) => (
                    <li
                      key={event.id}
                      className="border-b pb-3 last:border-b-0"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <strong className="text-xs">
                          {event.eventType.replaceAll("_", " ")}
                        </strong>
                        <time className="shrink-0 text-xs text-muted-foreground">
                          {new Date(event.createdAt).toLocaleTimeString(
                            "en-AU",
                          )}
                        </time>
                      </div>
                      <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                        {event.message}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
