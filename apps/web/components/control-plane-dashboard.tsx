"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Cable,
  CheckCircle2,
  CircleDashed,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ControlPlaneStatus } from "@/lib/control-plane-status";
import { relativeTime } from "@/lib/utils";
import { OpsShell } from "@/components/ops-shell";

function statusTone(status: string) {
  if (status === "ready" || status === "completed" || status === "healthy")
    return "border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300";
  if (status === "degraded" || status === "configured" || status === "queued")
    return "border-amber-600/40 bg-amber-600/10 text-amber-800 dark:text-amber-200";
  if (status === "unavailable" || status === "failed")
    return "border-red-600/40 bg-red-600/10 text-red-700 dark:text-red-300";
  return "border-border bg-muted text-muted-foreground";
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={statusTone(status)}>
      {status === "ready" ? (
        <CheckCircle2 className="size-3" aria-hidden />
      ) : status === "degraded" || status === "unknown" ? (
        <CircleDashed className="size-3" aria-hidden />
      ) : (
        <AlertTriangle className="size-3" aria-hidden />
      )}
      {status}
    </Badge>
  );
}

export function ControlPlaneDashboard() {
  const [data, setData] = useState<ControlPlaneStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/control-plane/status", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          detail?: string;
          title?: string;
        } | null;
        throw new Error(body?.detail || body?.title || `HTTP ${response.status}`);
      }
      const body = (await response.json()) as { data: ControlPlaneStatus };
      setData(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <OpsShell>
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Control plane health
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Chat with Parker, Jessie, and Alfie in Slack. This screen only
              shows whether the control plane is wired and agents can run.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {error ? (
          <Card className="border-red-600/40">
            <CardContent className="py-4 text-sm text-red-700 dark:text-red-300">
              {error}
            </CardContent>
          </Card>
        ) : null}

        {data ? (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="size-4" aria-hidden />
                    Overall
                  </CardTitle>
                  <StatusBadge status={data.overall} />
                </div>
                <CardDescription>
                  Updated {relativeTime(data.generatedAt)}
                </CardDescription>
              </CardHeader>
            </Card>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>Readiness</CardTitle>
                    <StatusBadge
                      status={
                        data.readiness.status === "ready" ? "ready" : "degraded"
                      }
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-1.5 text-sm">
                  {data.readiness.dependencies.map((dep) => (
                    <div
                      key={dep.name}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-muted-foreground">{dep.name}</span>
                      <StatusBadge status={dep.status === "ready" ? "ready" : "unavailable"} />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>Codex</CardTitle>
                    <StatusBadge status={data.codex.status} />
                  </div>
                  <CardDescription>
                    {data.codex.runtime ?? "agent-gateway"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {data.codex.detail ?? "—"}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">
                      <Cable className="size-4" aria-hidden />
                      Kelpie
                    </CardTitle>
                    <StatusBadge status={data.kelpie.status} />
                  </div>
                  <CardDescription>
                    {data.kelpie.displayName ?? "No live connector"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  <p className="truncate font-mono text-xs">
                    {data.kelpie.baseUrl ?? "—"}
                  </p>
                  <p>
                    Last sync:{" "}
                    {data.kelpie.lastSyncAt
                      ? relativeTime(data.kelpie.lastSyncAt)
                      : "never"}
                  </p>
                  <Link
                    href="/integrations/connectors"
                    className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Connectors
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">
                      <Cable className="size-4" aria-hidden />
                      Tawny
                    </CardTitle>
                    <StatusBadge status={data.tawny.status} />
                  </div>
                  <CardDescription>
                    {data.tawny.displayName ?? "No live connector"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  <p className="truncate font-mono text-xs">
                    {data.tawny.baseUrl ?? "—"}
                  </p>
                  <p>
                    Last sync:{" "}
                    {data.tawny.lastSyncAt
                      ? relativeTime(data.tawny.lastSyncAt)
                      : "never"}
                  </p>
                  <Link
                    href="/integrations/connectors"
                    className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Connectors
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">
                      <Cable className="size-4" aria-hidden />
                      Brolga
                    </CardTitle>
                    <StatusBadge status={data.brolga.status} />
                  </div>
                  <CardDescription>
                    {data.brolga.displayName ?? "No live connector"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  <p className="truncate font-mono text-xs">
                    {data.brolga.baseUrl ?? "—"}
                  </p>
                  <p>
                    Last sync:{" "}
                    {data.brolga.lastSyncAt
                      ? relativeTime(data.brolga.lastSyncAt)
                      : "never"}
                  </p>
                  <Link
                    href="/integrations/connectors"
                    className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Connectors
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="size-4" aria-hidden />
                      Slack
                    </CardTitle>
                    <StatusBadge status={data.slack.status} />
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  <p>
                    Install and exposures are managed under Slack settings.
                    Chat the bot in Slack — not here.
                  </p>
                  <Link
                    href="/settings/slack"
                    className="mt-2 inline-block text-xs font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Slack settings
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>MCP (Hermes)</CardTitle>
                    <StatusBadge status={data.mcp.status} />
                  </div>
                  <CardDescription>
                    {data.mcp.activeInstallations} active installation
                    {data.mcp.activeInstallations === 1 ? "" : "s"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  {data.mcp.installations.length === 0 ? (
                    <p>No MCP installations. Use bootstrap --wire-hermes-mcp.</p>
                  ) : (
                    data.mcp.installations.map((row) => (
                      <div key={row.id} className="flex justify-between gap-2">
                        <span className="truncate">{row.name}</span>
                        <span className="font-mono text-xs">{row.tokenPrefix}…</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="size-4" aria-hidden />
                  Agent pack
                </CardTitle>
                <CardDescription>
                  Parker (default), Jessie (hunt), Alfie (research). Address by
                  name in Slack: “Hey Jessie …”, “talk to Alfie …”.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-3 font-medium">Agent</th>
                      <th className="py-2 pr-3 font-medium">Runtime</th>
                      <th className="py-2 pr-3 font-medium">Slack</th>
                      <th className="py-2 pr-3 font-medium">Last run</th>
                      <th className="py-2 font-medium">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agents.map((agent) => (
                      <tr key={agent.id} className="border-b border-border/70">
                        <td className="py-2.5 pr-3 font-medium">
                          <Link
                            href={`/agents/${agent.id}`}
                            className="hover:underline"
                          >
                            {agent.name}
                          </Link>
                          {agent.slackDefault ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              default
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                          {agent.runtime}
                        </td>
                        <td className="py-2.5 pr-3">
                          {agent.slackExposed ? (
                            <StatusBadge status="ready" />
                          ) : (
                            <StatusBadge status="degraded" />
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-muted-foreground">
                          {agent.lastRun ? (
                            <span>
                              {agent.lastRun.status} ·{" "}
                              {agent.lastRun.startedAt
                                ? relativeTime(agent.lastRun.startedAt)
                                : "—"}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2.5">
                          {agent.killSwitch ? (
                            <StatusBadge status="unavailable" />
                          ) : (
                            <StatusBadge status={agent.status === "active" ? "ready" : agent.status} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">
              CLI status board:{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                ./scripts/bootstrap-e2e-homelab.sh --check-only
              </code>
            </p>
          </>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading control plane…</p>
        ) : null}
      </div>
    </OpsShell>
  );
}
