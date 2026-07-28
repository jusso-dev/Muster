import { createHash } from "node:crypto";
import { appendAuditEvent, database } from "@muster/database";
import { MCP_TOOL_VERSIONS, type McpToolName } from "./constants.ts";
import type { InstallationContext } from "./installation.ts";

type Database = ReturnType<typeof database>;

export type InvocationOutcome = "success" | "denied" | "error";

/**
 * Persists one organisation-scoped invocation/audit record per tool call:
 * tool + version, installation/actor, outcome, a hash of the returned
 * payload, and evidence references. Never the model's reasoning or prompt.
 */
export async function recordInvocation(
  db: Database,
  context: InstallationContext,
  input: {
    tool: McpToolName;
    outcome: InvocationOutcome;
    resultPayload?: unknown;
    errorCode?: string | undefined;
    evidenceRefs?: readonly string[] | undefined;
    traceId: string;
  },
): Promise<void> {
  const resultHash =
    input.resultPayload === undefined
      ? undefined
      : createHash("sha256")
          .update(JSON.stringify(input.resultPayload))
          .digest("hex");
  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      organisationId: context.subject.organisationId,
      actorId: context.subject.actorId,
      actorType: context.actorType,
      action: "mcp.tool.invoked",
      targetType: "mcp_tool",
      targetId: input.tool,
      metadata: {
        tool: input.tool,
        toolVersion: MCP_TOOL_VERSIONS[input.tool],
        installationId: context.installationId,
        outcome: input.outcome,
        ...(resultHash ? { resultHash } : {}),
        evidenceRefs: input.evidenceRefs ?? [],
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      },
      traceId: input.traceId,
    });
  });
}
