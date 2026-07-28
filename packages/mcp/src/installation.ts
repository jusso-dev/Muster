import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  capabilities,
  type AuthorisationSubject,
  type Capability,
} from "@muster/authz";
import type { ActorTypeSchema } from "@muster/contracts";
import { appendAuditEvent, database, newId, schema } from "@muster/database";
import type { z } from "zod";
import { MCP_TOOL_NAMES, type McpToolName } from "./constants.ts";

type Database = ReturnType<typeof database>;

const TOKEN_PREFIX = "muster_mcp_";

export interface InstallationContext {
  installationId: string;
  installationName: string;
  scopes: readonly McpToolName[];
  subject: AuthorisationSubject;
  actorType: z.infer<typeof ActorTypeSchema>;
}

export function hashInstallationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateToken() {
  const secret = randomBytes(32).toString("base64url");
  const token = `${TOKEN_PREFIX}${secret}`;
  return {
    token,
    tokenHash: hashInstallationToken(token),
    tokenPrefix: token.slice(0, TOKEN_PREFIX.length + 8),
  };
}

export async function createInstallation(
  db: Database,
  input: {
    organisationId: string;
    name: string;
    boundActorId: string;
    installedByActorId: string;
    scopes?: readonly McpToolName[];
    traceId: string;
  },
): Promise<{ id: string; token: string }> {
  const { token, tokenHash, tokenPrefix } = generateToken();
  const id = newId();
  const scopes = input.scopes ?? MCP_TOOL_NAMES;
  await db.transaction(async (tx) => {
    await tx.insert(schema.mcpInstallations).values({
      id,
      organisationId: input.organisationId,
      name: input.name,
      tokenHash,
      tokenPrefix,
      scopes,
      boundActorId: input.boundActorId,
      installedByActorId: input.installedByActorId,
    });
    await appendAuditEvent(tx, {
      organisationId: input.organisationId,
      actorId: input.installedByActorId,
      actorType: "human",
      action: "mcp.installation.created",
      targetType: "mcp_installation",
      targetId: id,
      metadata: { name: input.name, tokenPrefix, scopes },
      traceId: input.traceId,
    });
  });
  return { id, token };
}

export async function revokeInstallation(
  db: Database,
  input: {
    organisationId: string;
    installationId: string;
    revokedByActorId: string;
    traceId: string;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.mcpInstallations)
      .set({
        status: "revoked",
        revokedAt: new Date(),
        revokedByActorId: input.revokedByActorId,
      })
      .where(
        and(
          eq(schema.mcpInstallations.organisationId, input.organisationId),
          eq(schema.mcpInstallations.id, input.installationId),
          isNull(schema.mcpInstallations.revokedAt),
        ),
      )
      .returning({ id: schema.mcpInstallations.id });
    if (!updated) return false;
    await appendAuditEvent(tx, {
      organisationId: input.organisationId,
      actorId: input.revokedByActorId,
      actorType: "human",
      action: "mcp.installation.revoked",
      targetType: "mcp_installation",
      targetId: updated.id,
      metadata: {},
      traceId: input.traceId,
    });
    return true;
  });
}

/**
 * Resolves a bearer token to an org- and actor-scoped MCP context.
 * Every failure path (unknown, revoked, malformed, or cross-org token; a
 * deactivated bound actor) returns the same `null` — never distinguishing
 * "does not exist" from "is not authorised" to the caller.
 */
export async function resolveInstallation(
  db: Database,
  bearerToken: string,
): Promise<InstallationContext | null> {
  if (!bearerToken.startsWith(TOKEN_PREFIX)) return null;
  const tokenHash = hashInstallationToken(bearerToken);
  const [installation] = await db
    .select()
    .from(schema.mcpInstallations)
    .where(eq(schema.mcpInstallations.tokenHash, tokenHash))
    .limit(1);
  if (
    !installation ||
    installation.status !== "active" ||
    installation.revokedAt
  )
    return null;
  const [actor] = await db
    .select({
      id: schema.actors.id,
      organisationId: schema.actors.organisationId,
      status: schema.actors.status,
      actorType: schema.actors.actorType,
      capabilityAssignments: schema.actors.capabilityAssignments,
    })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.id, installation.boundActorId),
        eq(schema.actors.organisationId, installation.organisationId),
      ),
    )
    .limit(1);
  if (!actor || actor.status !== "active") return null;
  const assigned = Array.isArray(actor.capabilityAssignments)
    ? actor.capabilityAssignments.filter(
        (value): value is Capability =>
          typeof value === "string" &&
          capabilities.includes(value as Capability),
      )
    : [];
  const scopes = Array.isArray(installation.scopes)
    ? installation.scopes.filter((value): value is McpToolName =>
        (MCP_TOOL_NAMES as readonly string[]).includes(value as string),
      )
    : [];
  void (async () => {
    try {
      await db
        .update(schema.mcpInstallations)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.mcpInstallations.id, installation.id));
    } catch {
      // Best-effort liveness bookkeeping; never block or fail a call on it.
    }
  })();
  return {
    installationId: installation.id,
    installationName: installation.name,
    scopes,
    actorType: actor.actorType,
    subject: {
      actorId: actor.id,
      organisationId: actor.organisationId,
      capabilities: new Set(assigned),
    },
  };
}

export function requireScope(
  context: InstallationContext,
  tool: McpToolName,
): void {
  if (!context.scopes.includes(tool))
    throw new Error(`Installation is not scoped for ${tool}`);
}
