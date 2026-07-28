import { and, desc, eq, isNull } from "drizzle-orm";
import { database, newId, schema } from "@muster/database";
import { MCP_TOOL_NAMES, MCP_TOOL_VERSIONS } from "./constants.ts";
import { McpToolError } from "./errors.ts";
import { requireScope, type InstallationContext } from "./installation.ts";
import { queueKelpieQuery, pollKelpieQuery } from "./kelpie-gateway.ts";
import { classifyKelpieCase, classifyKelpieRecords } from "./redact.ts";

type Database = ReturnType<typeof database>;

const KELPIE_POLL_OPTIONS = { timeoutMs: 8_000, intervalMs: 400 };

export interface ToolResult<T> {
  payload: T;
  evidenceRefs?: readonly string[];
}

export async function getStatus(
  db: Database,
  context: InstallationContext,
): Promise<ToolResult<unknown>> {
  // Same selection rule as kelpie-gateway.ts's findKelpieIntegration: the
  // most recently touched, unarchived Kelpie integration, so status here
  // never disagrees with the one search/get actually query against.
  const [kelpie] = await db
    .select({
      status: schema.integrationRecords.status,
      mock: schema.integrationRecords.mock,
      lastSyncAt: schema.integrationRecords.lastSyncAt,
    })
    .from(schema.integrationRecords)
    .where(
      and(
        eq(
          schema.integrationRecords.organisationId,
          context.subject.organisationId,
        ),
        eq(schema.integrationRecords.product, "kelpie"),
        isNull(schema.integrationRecords.archivedAt),
      ),
    )
    .orderBy(desc(schema.integrationRecords.updatedAt))
    .limit(1);
  return {
    payload: {
      installation: { name: context.installationName, scopes: context.scopes },
      kelpie: kelpie
        ? {
            configured: true,
            status: kelpie.status,
            mock: kelpie.mock,
            lastSyncAt: kelpie.lastSyncAt,
          }
        : { configured: false },
    },
  };
}

export function listCapabilities(
  context: InstallationContext,
): ToolResult<unknown> {
  return {
    payload: {
      installation: { name: context.installationName },
      scopes: context.scopes,
      capabilities: [...context.subject.capabilities].sort(),
      tools: MCP_TOOL_NAMES.filter((name) => context.scopes.includes(name)).map(
        (name) => ({ name, version: MCP_TOOL_VERSIONS[name] }),
      ),
    },
  };
}

export async function searchKelpieCases(
  db: Database,
  context: InstallationContext,
  args: { query?: string | undefined; limit: number },
  traceId: string,
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_search_kelpie_cases");
  const queued = await queueKelpieQuery(db, context.subject, {
    templateKey: "kelpie.cases.list",
    input: {},
    idempotencyKey: `mcp:${context.installationId}:kelpie.cases.list:${newId()}`,
    traceId,
    requestedByActorType: context.actorType,
  });
  const settled = await pollKelpieQuery(
    db,
    context.subject,
    queued.id,
    KELPIE_POLL_OPTIONS,
  );
  if (settled.status === "failed")
    throw new McpToolError(
      "upstream_error",
      settled.errorMessage ?? "Kelpie case search failed.",
    );
  const records = Array.isArray(settled.result) ? settled.result : [];
  const filtered = args.query
    ? records.filter((record) =>
        JSON.stringify(record)
          .toLowerCase()
          .includes(args.query!.toLowerCase()),
      )
    : records;
  return {
    payload: classifyKelpieRecords(filtered, args.limit),
    evidenceRefs: [queued.id],
  };
}

export async function getKelpieCase(
  db: Database,
  context: InstallationContext,
  args: { caseId: string },
  traceId: string,
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_get_kelpie_case");
  const queued = await queueKelpieQuery(db, context.subject, {
    templateKey: "kelpie.case.get",
    input: { caseId: args.caseId },
    idempotencyKey: `mcp:${context.installationId}:kelpie.case.get:${newId()}`,
    traceId,
    requestedByActorType: context.actorType,
  });
  const settled = await pollKelpieQuery(
    db,
    context.subject,
    queued.id,
    KELPIE_POLL_OPTIONS,
  );
  if (settled.status === "failed") {
    if (
      settled.errorCode === "source_unavailable" ||
      settled.errorCode === "malformed_response"
    )
      throw new McpToolError(
        "not_found",
        "Kelpie case was not found or is unavailable.",
      );
    throw new McpToolError(
      "upstream_error",
      settled.errorMessage ?? "Kelpie case lookup failed.",
    );
  }
  return {
    payload: classifyKelpieCase(settled.result),
    evidenceRefs: [queued.id],
  };
}
