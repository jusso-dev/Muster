import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import {
  createInstallation,
  revokeInstallation,
  MCP_READ_TOOL_NAMES,
  MCP_TOOL_NAMES,
  type McpToolName,
} from "@muster/mcp";
import { database, schema } from "@muster/database";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ApiProblem } from "./api-context.ts";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  boundActorId: z.string().uuid(),
  scopes: z.array(z.string().min(1).max(100)).max(50).optional(),
});

function parseScopes(raw: string[] | undefined): readonly McpToolName[] {
  if (!raw) return MCP_READ_TOOL_NAMES;
  const allowed = new Set<string>(MCP_TOOL_NAMES);
  const scopes = raw.filter((value): value is McpToolName => allowed.has(value));
  if (scopes.length !== raw.length)
    throw new ApiProblem(
      400,
      "Invalid scopes",
      "One or more requested MCP tool scopes are unknown.",
    );
  return scopes;
}

export class McpInstallationDomainService {
  constructor(private readonly db = database()) {}

  async list(subject: AuthorisationSubject) {
    requireCapability(subject, "administration.manage");
    return this.db
      .select({
        id: schema.mcpInstallations.id,
        name: schema.mcpInstallations.name,
        status: schema.mcpInstallations.status,
        scopes: schema.mcpInstallations.scopes,
        boundActorId: schema.mcpInstallations.boundActorId,
        tokenPrefix: schema.mcpInstallations.tokenPrefix,
        installedAt: schema.mcpInstallations.installedAt,
        lastUsedAt: schema.mcpInstallations.lastUsedAt,
        revokedAt: schema.mcpInstallations.revokedAt,
      })
      .from(schema.mcpInstallations)
      .where(
        eq(schema.mcpInstallations.organisationId, subject.organisationId),
      )
      .orderBy(desc(schema.mcpInstallations.installedAt))
      .limit(200);
  }

  async create(
    subject: AuthorisationSubject,
    raw: unknown,
    traceId: string,
  ) {
    requireCapability(subject, "administration.manage");
    const input = CreateSchema.parse(raw);
    const scopes = parseScopes(input.scopes);
    try {
      const result = await createInstallation(this.db, {
        organisationId: subject.organisationId,
        name: input.name,
        boundActorId: input.boundActorId,
        installedByActorId: subject.actorId,
        scopes,
        traceId,
      });
      return {
        id: result.id,
        token: result.token,
        scopes,
        note: "Store the token in Hermes secret storage immediately; it is not recoverable.",
      };
    } catch (error) {
      throw new ApiProblem(
        400,
        "Installation create failed",
        error instanceof Error ? error.message : "Unable to create installation.",
      );
    }
  }

  async revoke(
    subject: AuthorisationSubject,
    installationId: string,
    traceId: string,
  ) {
    requireCapability(subject, "administration.manage");
    const [row] = await this.db
      .select({ id: schema.mcpInstallations.id })
      .from(schema.mcpInstallations)
      .where(
        and(
          eq(schema.mcpInstallations.organisationId, subject.organisationId),
          eq(schema.mcpInstallations.id, installationId),
          isNull(schema.mcpInstallations.revokedAt),
        ),
      )
      .limit(1);
    if (!row)
      throw new ApiProblem(
        404,
        "Not found",
        "MCP installation does not exist or is already revoked.",
      );
    await revokeInstallation(this.db, {
      organisationId: subject.organisationId,
      installationId,
      revokedByActorId: subject.actorId,
      traceId,
    });
    return { id: installationId, status: "revoked" as const };
  }
}
