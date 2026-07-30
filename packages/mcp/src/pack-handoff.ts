import { and, eq } from "drizzle-orm";
import {
  requestPackHandoff,
  PackHandoffError,
  type PackHandoffReason,
} from "@muster/agents";
import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import { McpToolError } from "./errors.ts";
import { requireScope, type InstallationContext } from "./installation.ts";
import type { ToolResult } from "./tools.ts";

type Database = ReturnType<typeof database>;

async function resolveAgentActorId(
  db: Database,
  organisationId: string,
  name: string,
): Promise<string> {
  const [agent] = await db
    .select({ id: schema.agentDefinitions.id })
    .from(schema.agentDefinitions)
    .where(
      and(
        eq(schema.agentDefinitions.organisationId, organisationId),
        eq(schema.agentDefinitions.name, name),
      ),
    )
    .limit(1);
  if (!agent)
    throw new McpToolError("not_found", `Agent ${name} is not defined here.`);
  return agent.id;
}

/**
 * Request a governed pack handoff. The allowed-route graph, capability check
 * and approval gate all live in the shared domain, so an MCP client cannot
 * reach a route the Slack harness or web API would refuse.
 */
export async function requestAgentHandoff(
  db: Database,
  context: InstallationContext,
  args: {
    fromAgent: string;
    toAgent: string;
    reason: PackHandoffReason;
    summary: string;
    idempotencyKey: string;
    requestedCapabilities?: string[] | undefined;
    evidenceReferences?: string[] | undefined;
    taskId?: string | undefined;
    roomId?: string | undefined;
    missionId?: string | undefined;
  },
  traceId: string,
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_request_agent_handoff");
  requireCapability(context.subject, "agents.handoff");
  requireCapability(context.subject, "agents.invoke");

  const organisationId = context.subject.organisationId;
  const [fromAgentActorId, toAgentActorId] = await Promise.all([
    resolveAgentActorId(db, organisationId, args.fromAgent),
    resolveAgentActorId(db, organisationId, args.toAgent),
  ]);

  try {
    const result = await requestPackHandoff(
      context.subject,
      {
        idempotencyKey: args.idempotencyKey,
        fromAgentActorId,
        toAgentActorId,
        reason: args.reason,
        summary: args.summary,
        ...(args.requestedCapabilities
          ? { requestedCapabilities: args.requestedCapabilities }
          : {}),
        ...(args.evidenceReferences
          ? { evidenceReferences: args.evidenceReferences }
          : {}),
        ...(args.taskId ? { taskId: args.taskId } : {}),
        ...(args.roomId ? { roomId: args.roomId } : {}),
        ...(args.missionId ? { missionId: args.missionId } : {}),
      },
      traceId,
    );
    return {
      payload: {
        handoffId: result.id,
        status: result.status,
        duplicate: result.duplicate,
        detail: result.detail,
        // Explicit so a client never reads a queued handoff as "the target
        // agent has already acted on this".
        note: "A handoff is a governed request. It never executes an external action and never authorises the target agent.",
      },
    };
  } catch (error) {
    if (error instanceof PackHandoffError) {
      throw new McpToolError(
        error.status === 404 ? "not_found" : "invalid_input",
        error.detail,
      );
    }
    throw error;
  }
}
