"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Bot, Clock3, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ActivityAgent = {
  agentId: string;
  agentName: string;
  agentAvatar: string | null;
  runId: string;
  status: "queued" | "running";
  headline: string;
  activityAt: string | null;
  activeSince: string;
  lastCompletedAt: string | null;
};

type ActivityData = {
  roomId: string;
  roomName: string;
  activeAgents: ActivityAgent[];
};

type RunDetail = {
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function elapsed(since: string): string {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(since).getTime()) / 1_000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function recent(value: string): string {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1_000),
  );
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function RoomAgentActivity({
  roomId,
  roomResolved,
  showDemoFallback = false,
}: {
  roomId: string;
  roomResolved: boolean;
  showDemoFallback?: boolean;
}) {
  const [data, setData] = useState<ActivityData | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    setPanelOpen(false);
    setSelectedRunId(null);
    setRunDetail(null);
    setData(null);
    if (!roomResolved) return;
    const controller = new AbortController();
    const refresh = async () => {
      const response = await fetch(`/api/v1/rooms/${roomId}/agent-activity`, {
        signal: controller.signal,
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { data: ActivityData };
      setData(payload.data);
    };
    void refresh().catch(() => undefined);
    const timer = window.setInterval(
      () => void refresh().catch(() => undefined),
      5_000,
    );
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [roomId, roomResolved]);

  useEffect(() => {
    if (data && data.activeAgents.length < 2) setPanelOpen(false);
  }, [data]);

  useEffect(() => {
    if (!panelOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [panelOpen]);

  async function openRun(runId: string) {
    setSelectedRunId(runId);
    setRunDetail(null);
    setRunError(null);
    setRunLoading(true);
    try {
      const response = await fetch(`/api/v1/agent-runs/${runId}/timeline`);
      if (!response.ok) throw new Error("Run timeline unavailable.");
      const payload = (await response.json()) as { data: RunDetail };
      setRunDetail(payload.data);
    } catch {
      setRunError("Run timeline unavailable.");
    } finally {
      setRunLoading(false);
    }
  }

  const agents = data?.activeAgents ?? [];
  if (agents.length === 0) {
    if (!showDemoFallback) return null;
    return (
      <div className="mx-4 mt-3 flex items-center gap-2 rounded border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-2 text-xs">
        <Bot className="size-4 text-[var(--color-agent)]" />
        <span className="flex-1">
          <strong>Detection Engineering Agent</strong> is drafting Sigma and KQL
          proposals…
        </span>
        <Badge className="agent-surface">Running · 01:18</Badge>
      </div>
    );
  }

  const single = agents[0]!;
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        data-testid="room-agent-activity"
        className="mx-4 mt-3 flex min-w-0 items-center gap-2 rounded border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-2 text-xs"
      >
        <Bot className="size-4 shrink-0 text-[var(--color-agent)]" />
        {agents.length === 1 ? (
          <>
            <span className="min-w-0 flex-1 truncate">
              <strong>{single.agentName}</strong> · {single.headline}
            </span>
            <Badge className="agent-surface shrink-0">
              {single.status === "running" ? "Running" : "Queued"} ·{" "}
              {elapsed(single.activeSince)}
            </Badge>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">
              <strong>{agents.length} agents working</strong> ·{" "}
              {single.headline}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 min-h-7 shrink-0 px-2"
              onClick={() => setPanelOpen(true)}
            >
              View all
            </Button>
          </>
        )}
      </div>

      {panelOpen && (
        <>
          <button
            type="button"
            aria-label="Close agent activity"
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setPanelOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-activity-title"
            data-testid="agent-activity-panel"
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-xl tablet:w-[28rem]"
          >
            <header className="flex min-h-14 items-center gap-2 border-b px-4">
              {selectedRunId && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Back to all active agents"
                  onClick={() => {
                    setSelectedRunId(null);
                    setRunDetail(null);
                    setRunError(null);
                  }}
                >
                  <ArrowLeft />
                </Button>
              )}
              <div className="min-w-0 flex-1">
                <h2
                  id="agent-activity-title"
                  className="truncate font-display text-sm font-bold"
                >
                  {selectedRunId ? "Run timeline" : "Agents working now"}
                </h2>
                <p className="truncate text-xs text-muted-foreground">
                  {data?.roomName}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close agent activity panel"
                onClick={() => setPanelOpen(false)}
              >
                <X />
              </Button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {selectedRunId ? (
                <>
                  {runLoading && (
                    <p className="text-sm text-muted-foreground">
                      Loading append-only timeline…
                    </p>
                  )}
                  {runError && (
                    <p role="alert" className="text-sm text-destructive">
                      {runError}
                    </p>
                  )}
                  {runDetail && (
                    <ol className="space-y-3">
                      {runDetail.events.map((event) => (
                        <li
                          key={event.id}
                          className="border-b pb-3 last:border-b-0"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <strong className="text-xs">
                              {event.eventType.replaceAll("_", " ")}
                            </strong>
                            <time className="shrink-0 text-xs text-muted-foreground">
                              {new Date(event.createdAt).toLocaleTimeString()}
                            </time>
                          </div>
                          <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                            {event.message}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  {agents.map((agent) => (
                    <article
                      key={agent.runId}
                      className="rounded border bg-card p-3"
                    >
                      <div className="flex items-start gap-3">
                        <Avatar
                          initials={initials(agent.agentName)}
                          agent
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="truncate text-sm font-bold">
                              {agent.agentName}
                            </h3>
                            <Badge className="agent-surface shrink-0">
                              {agent.status === "running"
                                ? "Running"
                                : "Queued"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            In {data?.roomName} · {elapsed(agent.activeSince)}
                          </p>
                          <p className="mt-2 line-clamp-2 break-words text-xs leading-5">
                            {agent.headline}
                          </p>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                              <Clock3 className="size-3 shrink-0" />
                              {agent.lastCompletedAt
                                ? `Last completed ${recent(agent.lastCompletedAt)}`
                                : "No prior completion in this room"}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void openRun(agent.runId)}
                            >
                              View
                            </Button>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
