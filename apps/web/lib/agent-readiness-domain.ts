import { and, desc, eq } from "drizzle-orm";
import {
  reduceAgentReadiness,
  type AgentPermissionMode,
  type AgentReadinessSummary,
} from "@muster/agents";
import { redactForObservation } from "@muster/config";
import { database, schema } from "@muster/database";

export type AgentReadinessDirectoryEntry = {
  id: string;
  name: string;
  description: string;
  initials: string;
  configuredRuntime: string;
  configuredModel: string;
  owner: string;
  status: string;
  killSwitch: boolean;
  roomCount: number;
  allowedToolCount: number;
  readiness: AgentReadinessSummary;
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function permissionMode(value: string): AgentPermissionMode {
  return value === "read_only" || value === "approval_gated"
    ? value
    : "unknown";
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export async function agentReadinessDirectory(
  organisationId: string,
): Promise<AgentReadinessDirectoryEntry[]> {
  const db = database();
  const [definitions, snapshots] = await Promise.all([
    db
      .select({
        definition: schema.agentDefinitions,
        owner: schema.actors.displayName,
      })
      .from(schema.agentDefinitions)
      .innerJoin(
        schema.actors,
        and(
          eq(schema.actors.id, schema.agentDefinitions.ownerActorId),
          eq(
            schema.actors.organisationId,
            schema.agentDefinitions.organisationId,
          ),
        ),
      )
      .where(eq(schema.agentDefinitions.organisationId, organisationId))
      .orderBy(schema.agentDefinitions.name),
    db
      .select()
      .from(schema.agentReadinessSnapshots)
      .where(
        eq(schema.agentReadinessSnapshots.organisationId, organisationId),
      )
      .orderBy(desc(schema.agentReadinessSnapshots.verifiedAt))
      .limit(500),
  ]);
  const currentProcessIdentity = snapshots[0]?.processIdentity ?? null;
  const latestByAgent = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    if (!latestByAgent.has(snapshot.agentId)) {
      latestByAgent.set(snapshot.agentId, snapshot);
    }
  }

  const projection = definitions.map(({ definition, owner }) => {
    const snapshot = latestByAgent.get(definition.id);
    const readiness = reduceAgentReadiness(
      {
        status: definition.status,
        killSwitch: definition.killSwitch,
        requestedPermissionMode: permissionMode(
          definition.requestedPermissionMode,
        ),
      },
      snapshot,
      currentProcessIdentity,
    );
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      initials: initials(definition.name),
      configuredRuntime: definition.runtime,
      configuredModel: definition.model,
      owner,
      status: definition.status,
      killSwitch: definition.killSwitch,
      roomCount: strings(definition.allowedRooms).length,
      allowedToolCount: strings(definition.allowedTools).length,
      readiness,
    };
  });
  return redactForObservation(projection) as AgentReadinessDirectoryEntry[];
}

export async function agentReadinessEntry(
  organisationId: string,
  agentId: string,
) {
  return (await agentReadinessDirectory(organisationId)).find(
    (agent) => agent.id === agentId,
  ) ?? null;
}
