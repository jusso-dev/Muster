import { and, desc, eq, isNull } from "drizzle-orm";
import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import { SlackGovernanceAdapter } from "@muster/agent-harness";
import { database, schema } from "@muster/database";
import { musterReadiness } from "./readiness.ts";

export type ControlPlaneComponentStatus = "ready" | "degraded" | "unavailable" | "unknown";

export type ControlPlaneStatus = {
  generatedAt: string;
  overall: ControlPlaneComponentStatus;
  readiness: Awaited<ReturnType<typeof musterReadiness>>;
  codex: {
    status: ControlPlaneComponentStatus;
    authenticated: boolean | null;
    runtime: string | null;
    detail: string | null;
  };
  kelpie: {
    status: ControlPlaneComponentStatus;
    instanceId: string | null;
    displayName: string | null;
    baseUrl: string | null;
    lastSyncAt: string | null;
  };
  tawny: {
    status: ControlPlaneComponentStatus;
    instanceId: string | null;
    displayName: string | null;
    baseUrl: string | null;
    lastSyncAt: string | null;
  };
  brolga: {
    status: ControlPlaneComponentStatus;
    instanceId: string | null;
    displayName: string | null;
    baseUrl: string | null;
    lastSyncAt: string | null;
  };
  slack: {
    status: ControlPlaneComponentStatus;
    health: unknown;
  };
  mcp: {
    status: ControlPlaneComponentStatus;
    activeInstallations: number;
    installations: Array<{
      id: string;
      name: string;
      tokenPrefix: string;
      lastUsedAt: string | null;
    }>;
  };
  agents: Array<{
    id: string;
    name: string;
    status: string;
    killSwitch: boolean;
    runtime: string;
    systemPromptVersion: string;
    slackExposed: boolean;
    slackDefault: boolean;
    lastRun: {
      id: string;
      status: string;
      startedAt: string | null;
      completedAt: string | null;
    } | null;
  }>;
};

function worst(
  ...statuses: ControlPlaneComponentStatus[]
): ControlPlaneComponentStatus {
  if (statuses.includes("unavailable")) return "unavailable";
  if (statuses.includes("degraded")) return "degraded";
  if (statuses.includes("unknown")) return "unknown";
  return "ready";
}

async function probeCodex(): Promise<ControlPlaneStatus["codex"]> {
  const base =
    process.env.AGENT_GATEWAY_URL?.trim() || "http://agent-gateway:3002";
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/ready`, {
      signal: AbortSignal.timeout(2_000),
    });
    const body = (await response.json()) as {
      status?: string;
      authenticated?: boolean;
      runtime?: string;
    };
    const authenticated = body.authenticated === true;
    return {
      status: response.ok && authenticated ? "ready" : "degraded",
      authenticated: typeof body.authenticated === "boolean" ? body.authenticated : null,
      runtime: typeof body.runtime === "string" ? body.runtime : null,
      detail: response.ok
        ? authenticated
          ? "Codex authenticated"
          : "Gateway up; Codex not authenticated"
        : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: "unavailable",
      authenticated: null,
      runtime: null,
      detail: error instanceof Error ? error.message : "Codex probe failed",
    };
  }
}

export async function getControlPlaneStatus(
  subject: AuthorisationSubject,
): Promise<ControlPlaneStatus> {
  requireCapability(subject, "administration.manage");
  const db = database();

  const connectorSelect = {
    id: schema.integrationRecords.id,
    instanceId: schema.integrationRecords.instanceId,
    displayName: schema.integrationRecords.displayName,
    status: schema.integrationRecords.status,
    configuration: schema.integrationRecords.configuration,
    lastSyncAt: schema.integrationRecords.lastSyncAt,
    mock: schema.integrationRecords.mock,
  };

  const [
    readiness,
    codex,
    kelpieRows,
    tawnyRows,
    brolgaRows,
    mcpRows,
    agentRows,
    exposures,
    slackHealth,
  ] = await Promise.all([
    musterReadiness(),
    probeCodex(),
    db
      .select(connectorSelect)
      .from(schema.integrationRecords)
      .where(
        and(
          eq(schema.integrationRecords.organisationId, subject.organisationId),
          eq(schema.integrationRecords.product, "kelpie"),
          isNull(schema.integrationRecords.archivedAt),
          eq(schema.integrationRecords.mock, false),
        ),
      )
      .orderBy(desc(schema.integrationRecords.updatedAt))
      .limit(1),
    db
      .select(connectorSelect)
      .from(schema.integrationRecords)
      .where(
        and(
          eq(schema.integrationRecords.organisationId, subject.organisationId),
          eq(schema.integrationRecords.product, "tawny"),
          isNull(schema.integrationRecords.archivedAt),
          eq(schema.integrationRecords.mock, false),
        ),
      )
      .orderBy(desc(schema.integrationRecords.updatedAt))
      .limit(1),
    db
      .select(connectorSelect)
      .from(schema.integrationRecords)
      .where(
        and(
          eq(schema.integrationRecords.organisationId, subject.organisationId),
          eq(schema.integrationRecords.product, "brolga"),
          isNull(schema.integrationRecords.archivedAt),
          eq(schema.integrationRecords.mock, false),
        ),
      )
      .orderBy(desc(schema.integrationRecords.updatedAt))
      .limit(1),
    db
      .select({
        id: schema.mcpInstallations.id,
        name: schema.mcpInstallations.name,
        tokenPrefix: schema.mcpInstallations.tokenPrefix,
        lastUsedAt: schema.mcpInstallations.lastUsedAt,
        status: schema.mcpInstallations.status,
      })
      .from(schema.mcpInstallations)
      .where(
        and(
          eq(schema.mcpInstallations.organisationId, subject.organisationId),
          eq(schema.mcpInstallations.status, "active"),
          isNull(schema.mcpInstallations.revokedAt),
        ),
      )
      .orderBy(desc(schema.mcpInstallations.installedAt))
      .limit(20),
    db
      .select({
        id: schema.agentDefinitions.id,
        name: schema.agentDefinitions.name,
        status: schema.agentDefinitions.status,
        killSwitch: schema.agentDefinitions.killSwitch,
        runtime: schema.agentDefinitions.runtime,
        systemPromptVersion: schema.agentDefinitions.systemPromptVersion,
      })
      .from(schema.agentDefinitions)
      .where(eq(schema.agentDefinitions.organisationId, subject.organisationId))
      .orderBy(schema.agentDefinitions.name),
    db
      .select({
        agentId: schema.slackAgentExposures.agentId,
        enabled: schema.slackAgentExposures.enabled,
        isDefault: schema.slackAgentExposures.isDefault,
      })
      .from(schema.slackAgentExposures)
      .where(eq(schema.slackAgentExposures.organisationId, subject.organisationId)),
    new SlackGovernanceAdapter().health(subject).catch(() => null),
  ]);

  function connectorComponent(
    row:
      | {
          instanceId: string;
          displayName: string;
          status: string;
          configuration: unknown;
          lastSyncAt: Date | null;
        }
      | undefined,
  ): ControlPlaneStatus["kelpie"] {
    const config =
      row?.configuration && typeof row.configuration === "object"
        ? (row.configuration as Record<string, unknown>)
        : {};
    const status: ControlPlaneComponentStatus = !row
      ? "unavailable"
      : row.status === "healthy"
        ? "ready"
        : "degraded";
    return {
      status,
      instanceId: row?.instanceId ?? null,
      displayName: row?.displayName ?? null,
      baseUrl: typeof config.baseUrl === "string" ? config.baseUrl : null,
      lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
    };
  }

  const kelpie = connectorComponent(kelpieRows[0]);
  const tawny = connectorComponent(tawnyRows[0]);
  const brolga = connectorComponent(brolgaRows[0]);

  const slackStatus: ControlPlaneComponentStatus = slackHealth
    ? "ready"
    : "unknown";

  const mcpStatus: ControlPlaneComponentStatus =
    mcpRows.length > 0 ? "ready" : "degraded";

  const exposureByAgent = new Map(
    exposures.map((row) => [row.agentId, row] as const),
  );

  const agents = await Promise.all(
    agentRows.map(async (agent) => {
      const [lastRun] = await db
        .select({
          id: schema.agentRuns.id,
          status: schema.agentRuns.status,
          startedAt: schema.agentRuns.startedAt,
          completedAt: schema.agentRuns.completedAt,
        })
        .from(schema.agentRuns)
        .where(
          and(
            eq(schema.agentRuns.organisationId, subject.organisationId),
            eq(schema.agentRuns.agentId, agent.id),
          ),
        )
        .orderBy(desc(schema.agentRuns.startedAt))
        .limit(1);
      const exposure = exposureByAgent.get(agent.id);
      return {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        killSwitch: agent.killSwitch,
        runtime: agent.runtime,
        systemPromptVersion: agent.systemPromptVersion,
        slackExposed: Boolean(exposure?.enabled),
        slackDefault: Boolean(exposure?.isDefault),
        lastRun: lastRun
          ? {
              id: lastRun.id,
              status: lastRun.status,
              startedAt: lastRun.startedAt?.toISOString() ?? null,
              completedAt: lastRun.completedAt?.toISOString() ?? null,
            }
          : null,
      };
    }),
  );

  const readinessStatus: ControlPlaneComponentStatus =
    readiness.status === "ready" ? "ready" : "degraded";

  return {
    generatedAt: new Date().toISOString(),
    overall: worst(
      readinessStatus,
      codex.status,
      kelpie.status,
      tawny.status,
      brolga.status,
      slackStatus === "unknown" ? "degraded" : slackStatus,
      mcpStatus,
    ),
    readiness,
    codex,
    kelpie,
    tawny,
    brolga,
    slack: {
      status: slackStatus,
      health: slackHealth,
    },
    mcp: {
      status: mcpStatus,
      activeInstallations: mcpRows.length,
      installations: mcpRows.map((row) => ({
        id: row.id,
        name: row.name,
        tokenPrefix: row.tokenPrefix,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      })),
    },
    agents,
  };
}
