import { and, count, desc, eq, inArray, max } from "drizzle-orm";
import { agentToolRegistry } from "@muster/agents";
import { capabilities as declaredCapabilities } from "@muster/authz";
import { database, schema } from "@muster/database";
import { ApiProblem } from "./api-context.ts";

export type AgentToolProfile = {
  name: string;
  /** Null when the definition allows a tool the runtime registry does not implement. */
  capability: string | null;
  mutation: boolean | null;
  approvalAction: string | null;
  registered: boolean;
  callCount: number;
  lastUsedAt: string | null;
};

export type AgentRoomProfile = {
  id: string;
  slug: string;
  displayName: string;
  roomType: string;
  /** Listed in the definition's allowedRooms. */
  allowed: boolean;
  /** Actually holds a membership row. */
  member: boolean;
};

export type AgentPermissionProfile = {
  required: string[];
  granted: string[];
  /**
   * Required but not granted. An agent in this state fails at run time with a
   * capability error, and nothing else in the product surfaces it.
   */
  missing: string[];
  /** Granted beyond what the definition declares it needs. */
  surplus: string[];
  /** Declared requirements that are not real capabilities at all. */
  unknown: string[];
  approvalRequirements: Record<string, unknown>;
  budgets: {
    maximumRuntimeSeconds: number;
    maximumTokenBudget: number;
    maximumCostCents: number;
  };
};

export type AgentProfile = {
  id: string;
  name: string;
  description: string;
  status: string;
  killSwitch: boolean;
  runtime: string;
  model: string;
  systemPromptVersion: string;
  tools: AgentToolProfile[];
  rooms: AgentRoomProfile[];
  slackExposures: Array<{
    installationId: string;
    teamName: string | null;
    enabled: boolean;
    isDefault: boolean;
  }>;
  permissions: AgentPermissionProfile;
};

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Read-only governance profile for one agent: what it may use, where it may
 * work, and whether its declared requirements match the capabilities it
 * actually holds. Every field is derived from stored state — nothing here
 * grants, revokes, or infers.
 */
export async function agentProfile(
  organisationId: string,
  agentId: string,
): Promise<AgentProfile> {
  const db = database();

  const [definition] = await db
    .select({
      id: schema.agentDefinitions.id,
      name: schema.agentDefinitions.name,
      description: schema.agentDefinitions.description,
      status: schema.agentDefinitions.status,
      killSwitch: schema.agentDefinitions.killSwitch,
      runtime: schema.agentDefinitions.runtime,
      model: schema.agentDefinitions.model,
      systemPromptVersion: schema.agentDefinitions.systemPromptVersion,
      allowedTools: schema.agentDefinitions.allowedTools,
      allowedRooms: schema.agentDefinitions.allowedRooms,
      capabilityRequirements: schema.agentDefinitions.capabilityRequirements,
      approvalRequirements: schema.agentDefinitions.approvalRequirements,
      maximumRuntimeSeconds: schema.agentDefinitions.maximumRuntimeSeconds,
      maximumTokenBudget: schema.agentDefinitions.maximumTokenBudget,
      maximumCostCents: schema.agentDefinitions.maximumCostCents,
    })
    .from(schema.agentDefinitions)
    .where(
      and(
        eq(schema.agentDefinitions.id, agentId),
        eq(schema.agentDefinitions.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!definition) throw new ApiProblem(404, "Not found", "Agent not found.");

  const allowedTools = stringList(definition.allowedTools);
  const allowedRooms = stringList(definition.allowedRooms);
  const required = stringList(definition.capabilityRequirements);

  const [actor] = await db
    .select({ capabilityAssignments: schema.actors.capabilityAssignments })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.id, agentId),
        eq(schema.actors.organisationId, organisationId),
      ),
    )
    .limit(1);
  const granted = stringList(actor?.capabilityAssignments);

  // Tool usage is per run, so aggregate through the agent's own runs rather
  // than trusting a tool name to be unique across the organisation.
  const usage = await db
    .select({
      toolName: schema.agentToolCalls.toolName,
      callCount: count(),
      lastUsedAt: max(schema.agentToolCalls.startedAt),
    })
    .from(schema.agentToolCalls)
    .innerJoin(
      schema.agentRuns,
      and(
        eq(schema.agentRuns.id, schema.agentToolCalls.runId),
        eq(schema.agentRuns.organisationId, schema.agentToolCalls.organisationId),
      ),
    )
    .where(
      and(
        eq(schema.agentToolCalls.organisationId, organisationId),
        eq(schema.agentRuns.agentId, agentId),
      ),
    )
    .groupBy(schema.agentToolCalls.toolName);
  const usageByTool = new Map(usage.map((row) => [row.toolName, row]));

  // Surface tools the agent has actually called even when the definition no
  // longer lists them — a call outside the declared envelope is exactly what
  // an operator needs to see.
  const toolNames = [
    ...new Set([...allowedTools, ...usage.map((row) => row.toolName)]),
  ].sort();
  const tools: AgentToolProfile[] = toolNames.map((name) => {
    const registered = agentToolRegistry.get(name);
    const used = usageByTool.get(name);
    return {
      name,
      capability: registered?.capability ?? null,
      mutation: registered?.mutation ?? null,
      approvalAction: registered?.approvalAction ?? null,
      registered: Boolean(registered),
      callCount: Number(used?.callCount ?? 0),
      lastUsedAt: used?.lastUsedAt?.toISOString() ?? null,
    };
  });

  const memberships = await db
    .select({ roomId: schema.roomMemberships.roomId })
    .from(schema.roomMemberships)
    .where(
      and(
        eq(schema.roomMemberships.organisationId, organisationId),
        eq(schema.roomMemberships.actorId, agentId),
      ),
    );
  const memberRoomIds = new Set(memberships.map((row) => row.roomId));
  const roomIds = [...new Set([...allowedRooms, ...memberRoomIds])];
  const roomRows = roomIds.length
    ? await db
        .select({
          id: schema.rooms.id,
          slug: schema.rooms.slug,
          displayName: schema.rooms.displayName,
          roomType: schema.rooms.roomType,
        })
        .from(schema.rooms)
        .where(
          and(
            eq(schema.rooms.organisationId, organisationId),
            inArray(schema.rooms.id, roomIds),
          ),
        )
    : [];
  const allowedRoomIds = new Set(allowedRooms);
  const rooms: AgentRoomProfile[] = roomRows
    .map((room) => ({
      id: room.id,
      slug: room.slug,
      displayName: room.displayName,
      roomType: room.roomType,
      allowed: allowedRoomIds.has(room.id),
      member: memberRoomIds.has(room.id),
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  const exposures = await db
    .select({
      installationId: schema.slackAgentExposures.installationId,
      enabled: schema.slackAgentExposures.enabled,
      isDefault: schema.slackAgentExposures.isDefault,
      teamName: schema.slackInstallations.teamName,
    })
    .from(schema.slackAgentExposures)
    .leftJoin(
      schema.slackInstallations,
      and(
        eq(
          schema.slackInstallations.id,
          schema.slackAgentExposures.installationId,
        ),
        eq(
          schema.slackInstallations.organisationId,
          schema.slackAgentExposures.organisationId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.slackAgentExposures.organisationId, organisationId),
        eq(schema.slackAgentExposures.agentId, agentId),
      ),
    )
    .orderBy(desc(schema.slackAgentExposures.isDefault));

  const grantedSet = new Set(granted);
  const requiredSet = new Set(required);
  const declared = new Set<string>(declaredCapabilities);

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    status: definition.status,
    killSwitch: definition.killSwitch,
    runtime: definition.runtime,
    model: definition.model,
    systemPromptVersion: definition.systemPromptVersion,
    tools,
    rooms,
    slackExposures: exposures.map((row) => ({
      installationId: row.installationId,
      teamName: row.teamName,
      enabled: row.enabled,
      isDefault: row.isDefault,
    })),
    permissions: {
      required: [...requiredSet].sort(),
      granted: [...grantedSet].sort(),
      missing: [...requiredSet].filter((item) => !grantedSet.has(item)).sort(),
      surplus: [...grantedSet].filter((item) => !requiredSet.has(item)).sort(),
      unknown: [...requiredSet].filter((item) => !declared.has(item)).sort(),
      approvalRequirements:
        definition.approvalRequirements &&
        typeof definition.approvalRequirements === "object" &&
        !Array.isArray(definition.approvalRequirements)
          ? (definition.approvalRequirements as Record<string, unknown>)
          : {},
      budgets: {
        maximumRuntimeSeconds: definition.maximumRuntimeSeconds,
        maximumTokenBudget: definition.maximumTokenBudget,
        maximumCostCents: definition.maximumCostCents,
      },
    },
  };
}
