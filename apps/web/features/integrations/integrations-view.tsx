"use client";

import Link from "next/link";
import { CompanyOsShell } from "@/components/os/company-os-shell";
import { EmptyState } from "@/components/os/empty-state";
import { ErrorState } from "@/components/os/error-state";
import { SkeletonRows } from "@/components/os/skeleton";
import { PageBody } from "@/components/os/page-body";
import { PageHeader } from "@/components/page-header";
import { HealthBadge } from "@/components/status/status-badges";
import { Badge } from "@/components/ui/badge";
import { useConnectors, useControlPlane } from "@/lib/queries/hooks";
import { relativeTime } from "@/lib/utils";
import type { IntegrationCard } from "@/types/os";
import { toHealthState, type HealthState } from "@/types/status";

type ControlPlaneSlice = {
  generatedAt: string;
  overall: string;
  kelpie: { status: string; displayName: string | null; lastSyncAt: string | null };
  tawny: { status: string; displayName: string | null; lastSyncAt: string | null };
  brolga: { status: string; displayName: string | null; lastSyncAt: string | null };
  slack: { status: string };
  mcp: { status: string; activeInstallations: number };
  codex: { status: string; runtime: string | null; detail: string | null };
  readiness: { status: string };
};

type ConnectorRow = {
  id: string;
  name?: string;
  product?: string;
  status?: string;
  displayName?: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
};

function controlPlaneCards(cp: ControlPlaneSlice): IntegrationCard[] {
  return [
    {
      id: "cp:kelpie",
      name: cp.kelpie.displayName || "Kelpie",
      product: "kelpie",
      enabled: true,
      health: toHealthState(cp.kelpie.status),
      lastSuccessAt: cp.kelpie.lastSyncAt,
      lastFailureAt: null,
      lastExecutionAt: cp.kelpie.lastSyncAt,
      authState: cp.kelpie.status === "ready" ? "configured" : cp.kelpie.status,
      capabilities: ["case coordination", "MCP query"],
      recentError: null,
      owner: null,
      source: "api",
    },
    {
      id: "cp:tawny",
      name: cp.tawny?.displayName || "Tawny",
      product: "tawny",
      enabled: true,
      health: toHealthState(cp.tawny?.status),
      lastSuccessAt: cp.tawny?.lastSyncAt ?? null,
      lastFailureAt: null,
      lastExecutionAt: cp.tawny?.lastSyncAt ?? null,
      authState: cp.tawny?.status === "ready" ? "configured" : (cp.tawny?.status ?? "unavailable"),
      capabilities: ["endpoint inventory", "hunts", "MCP query"],
      recentError: null,
      owner: null,
      source: "api",
    },
    {
      id: "cp:brolga",
      name: cp.brolga?.displayName || "Brolga",
      product: "brolga",
      enabled: true,
      health: toHealthState(cp.brolga?.status),
      lastSuccessAt: cp.brolga?.lastSyncAt ?? null,
      lastFailureAt: null,
      lastExecutionAt: cp.brolga?.lastSyncAt ?? null,
      authState:
        cp.brolga?.status === "ready"
          ? "configured"
          : (cp.brolga?.status ?? "unavailable"),
      capabilities: ["normalised TI", "context pack", "MCP query"],
      recentError: null,
      owner: null,
      source: "api",
    },
    {
      id: "cp:slack",
      name: "Slack",
      product: "slack",
      enabled: true,
      health: toHealthState(cp.slack.status),
      lastSuccessAt: null,
      lastFailureAt: null,
      lastExecutionAt: cp.generatedAt,
      authState: cp.slack.status,
      capabilities: ["agent delivery"],
      recentError: null,
      owner: null,
      source: "api",
    },
    {
      id: "cp:mcp",
      name: "Remote MCP",
      product: "mcp",
      enabled: cp.mcp.activeInstallations > 0,
      health: toHealthState(cp.mcp.status),
      lastSuccessAt: null,
      lastFailureAt: null,
      lastExecutionAt: cp.generatedAt,
      authState: `${cp.mcp.activeInstallations} installations`,
      capabilities: ["Hermes tools"],
      recentError: null,
      owner: null,
      source: "api",
    },
    {
      id: "cp:codex",
      name: "Agent runtime",
      product: "codex",
      enabled: true,
      health: toHealthState(cp.codex.status),
      lastSuccessAt: null,
      lastFailureAt: null,
      lastExecutionAt: cp.generatedAt,
      authState: cp.codex.detail ?? cp.codex.status,
      capabilities: [cp.codex.runtime ?? "runtime"],
      recentError: null,
      owner: null,
      source: "api",
    },
    {
      id: "cp:readiness",
      name: "PostgreSQL / Redis / BullMQ",
      product: "platform",
      enabled: true,
      health: toHealthState(cp.readiness.status),
      lastSuccessAt: cp.generatedAt,
      lastFailureAt: null,
      lastExecutionAt: cp.generatedAt,
      authState: "internal",
      capabilities: ["authoritative store", "queues"],
      recentError: null,
      owner: null,
      source: "api",
    },
  ];
}

function connectorCards(rows: ConnectorRow[]): IntegrationCard[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.displayName || row.name || row.product || "Connector",
    product: row.product || "connector",
    enabled: true,
    health: toHealthState(row.status ?? "unknown") as HealthState,
    lastSuccessAt: row.lastSyncAt ?? null,
    lastFailureAt: row.lastError ? row.lastSyncAt ?? null : null,
    lastExecutionAt: row.lastSyncAt ?? null,
    authState: row.status ?? "unknown",
    capabilities: [],
    recentError: row.lastError ?? null,
    owner: null,
    source: "api" as const,
  }));
}

export function IntegrationsView() {
  const controlPlane = useControlPlane();
  const connectors = useConnectors();

  const cards: IntegrationCard[] = [
    ...(controlPlane.data
      ? controlPlaneCards(controlPlane.data as ControlPlaneSlice)
      : []),
    ...connectorCards((connectors.data as ConnectorRow[] | undefined) ?? []),
  ];

  return (
    <CompanyOsShell>
      <PageHeader
        eyebrow="Configure"
        title="Integrations"
        description="Connector and platform health. Secrets never leave the backend."
        actions={
          <Link
            href="/integrations/connectors"
            className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted"
          >
            Connector admin
          </Link>
        }
      />
      <PageBody>
        {controlPlane.isError && connectors.isError ? (
          <ErrorState
            error={controlPlane.error}
            onRetry={() => {
              void controlPlane.refetch();
              void connectors.refetch();
            }}
          />
        ) : null}
        {(controlPlane.isLoading || connectors.isLoading) && cards.length === 0 ? (
          <SkeletonRows rows={6} />
        ) : null}
        {cards.length === 0 && !controlPlane.isLoading && !connectors.isLoading ? (
          <EmptyState
            title="No integration health visible"
            description="Requires administration or connector capabilities for this organisation."
          />
        ) : null}
        <div className="grid gap-3 tablet:grid-cols-2 wide:grid-cols-3">
          {cards.map((card) => (
            <article
              key={card.id}
              className="rounded-md border border-border bg-card p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">{card.name}</h2>
                  <p className="font-mono text-xs text-muted-foreground">
                    {card.product}
                  </p>
                </div>
                <HealthBadge health={card.health} />
              </div>
              <dl className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Enabled</dt>
                  <dd>{card.enabled ? "Yes" : "No"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Auth / state</dt>
                  <dd className="max-w-[12rem] truncate text-right">
                    {card.authState}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Last signal</dt>
                  <dd>
                    {card.lastExecutionAt
                      ? relativeTime(card.lastExecutionAt)
                      : "—"}
                  </dd>
                </div>
                {card.capabilities.length > 0 ? (
                  <div>
                    <dt className="text-muted-foreground">Capabilities</dt>
                    <dd className="mt-0.5 flex flex-wrap gap-1">
                      {card.capabilities.map((cap) => (
                        <Badge
                          key={cap}
                          className="bg-muted text-muted-foreground"
                        >
                          {cap}
                        </Badge>
                      ))}
                    </dd>
                  </div>
                ) : null}
                {card.recentError ? (
                  <p className="text-[var(--color-error)]">{card.recentError}</p>
                ) : null}
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">
                Credentials never displayed · source {card.source}
              </p>
            </article>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Also configure{" "}
          <Link href="/settings/slack" className="underline">
            Slack
          </Link>
          . External products remain authoritative for their own records.
        </p>
      </PageBody>
    </CompanyOsShell>
  );
}
