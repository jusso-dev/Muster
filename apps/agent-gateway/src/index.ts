import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { redactObservationText } from "@muster/config";
import { AgentInvestigationJobSchema } from "@muster/contracts";
import {
  appendAuditEvent,
  closeDatabase,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { DurableAgentRuntime } from "./runtime.ts";
import {
  isGatewayRequestAuthorised,
  parseGatewayOrganisationId,
} from "./service-auth.ts";

const AgentRunRequestSchema = AgentInvestigationJobSchema.extend({
  humanRequest: z.string().trim().min(1).max(4_000).optional(),
});

const executionRuntime =
  process.env.MUSTER_AGENT_RUNTIME === "mock" ? "mock" : "codex";
const codexHome = process.env.CODEX_HOME ?? "/var/lib/muster/codex";
const globalKillSwitch = process.env.AGENT_KILL_SWITCH === "true";
const gatewayToken = z
  .string()
  .min(32)
  .parse(process.env.MUSTER_AGENT_GATEWAY_TOKEN);
const runtime = new DurableAgentRuntime({
  executionRuntime,
  codexHome,
  isAuthenticated: codexAuthenticated,
  leaseMs: Number(process.env.MUSTER_AGENT_LEASE_MS ?? 30_000),
  pollMs: Number(process.env.MUSTER_AGENT_POLL_MS ?? 1_000),
});

async function codexAuthenticated() {
  try {
    await access(join(codexHome, "auth.json"));
    return true;
  } catch {
    return false;
  }
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function requestOrganisationId(request: IncomingMessage) {
  return parseGatewayOrganisationId(
    request.headers["x-muster-organisation-id"],
  );
}

async function queueDirectRun(
  input: z.infer<typeof AgentRunRequestSchema>,
  idempotencyKey: string,
) {
  const db = database();
  const [definition] = await db
    .select()
    .from(schema.agentDefinitions)
    .where(
      and(
        eq(schema.agentDefinitions.id, input.agentId),
        eq(schema.agentDefinitions.organisationId, input.organisationId),
        eq(schema.agentDefinitions.status, "active"),
        eq(schema.agentDefinitions.killSwitch, false),
      ),
    )
    .limit(1);
  if (!definition) throw new Error("Active agent definition not found");
  const humanRequest = input.humanRequest ?? "Review assigned investigation";
  const deadlineAt = new Date(
    Date.now() + definition.maximumRuntimeSeconds * 1_000,
  );
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(schema.agentRuns)
      .values({
        id: newId(),
        agentId: definition.id,
        organisationId: input.organisationId,
        investigationId: input.investigationId,
        requestedByActorId: input.requestedByActorId,
        trigger: "api",
        status: "queued",
        request: { humanRequest, traceId: input.traceId },
        progress: { stage: "queued", percent: 0 },
        deadlineAt,
        inputHash: createHash("sha256").update(humanRequest).digest("hex"),
        promptVersion: definition.systemPromptVersion,
        runtime: definition.runtime,
        model: definition.model,
        maximumRuntimeSeconds: definition.maximumRuntimeSeconds,
        maximumTokenBudget: definition.maximumTokenBudget,
        maximumCostCents: definition.maximumCostCents,
        idempotencyKey,
      })
      .onConflictDoNothing()
      .returning();
    const run =
      inserted ??
      (
        await tx
          .select()
          .from(schema.agentRuns)
          .where(
            and(
              eq(schema.agentRuns.organisationId, input.organisationId),
              eq(schema.agentRuns.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1)
      )[0];
    if (!run) throw new Error("Could not queue durable agent run");
    if (inserted) {
      await tx.insert(schema.agentRunEvents).values({
        id: newId(),
        organisationId: run.organisationId,
        runId: run.id,
        eventType: "queued",
        message: "Durable agent run accepted",
        payload: { trigger: "api" },
      });
      await writeOutbox(tx, {
        organisationId: run.organisationId,
        eventType: "agent.run.queued",
        aggregateType: "agent_run",
        aggregateId: run.id,
        queueName: "muster-agents",
        payload: { runId: run.id },
        idempotencyKey: `agent.run.queued:${run.id}`,
        traceId: input.traceId,
      });
      await appendAuditEvent(tx, {
        organisationId: run.organisationId,
        actorId: input.requestedByActorId,
        actorType: "human",
        action: "agent.run.queued",
        targetType: "agent_run",
        targetId: run.id,
        metadata: { trigger: "api", idempotencyKey },
        traceId: redactObservationText(input.traceId),
      });
    }
    return { run, duplicate: !inserted };
  });
}

const server = createServer(async (incoming, response) => {
  const url = new URL(incoming.url ?? "/", "http://agent-gateway.local");
  response.setHeader("content-type", "application/json");

  if (
    incoming.method === "GET" &&
    (url.pathname === "/health" || url.pathname === "/ready")
  ) {
    const authenticated =
      executionRuntime === "mock" || (await codexAuthenticated());
    response.writeHead(globalKillSwitch ? 503 : 200);
    response.end(
      JSON.stringify({
        status: globalKillSwitch
          ? "disabled"
          : authenticated
            ? "ready"
            : "authentication_required",
        runtime: executionRuntime === "codex" ? "codex-subscription" : "mock",
        authenticated,
        activeRuns: runtime.activeRunCount,
        authority: "postgresql",
      }),
    );
    return;
  }

  if (
    !isGatewayRequestAuthorised(incoming.headers.authorization, gatewayToken)
  ) {
    response.writeHead(401);
    response.end(JSON.stringify({ error: "Unauthorised" }));
    return;
  }

  const runMatch =
    incoming.method === "GET"
      ? url.pathname.match(/^\/v1\/runs\/([^/]+)$/)
      : null;
  if (runMatch?.[1]) {
    const organisationId = requestOrganisationId(incoming);
    if (!organisationId) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Organisation header required" }));
      return;
    }
    const run = await runtime.read(runMatch[1], organisationId);
    response.writeHead(run ? 200 : 404);
    response.end(JSON.stringify(run ?? { error: "Run not found" }));
    return;
  }

  if (
    incoming.method === "POST" &&
    (url.pathname === "/v1/runs/dispatch" ||
      url.pathname === "/v1/runs/execute")
  ) {
    if (globalKillSwitch) {
      response.writeHead(503);
      response.end(JSON.stringify({ error: "Agent kill switch is active" }));
      return;
    }
    void runtime.dispatch();
    response.writeHead(202);
    response.end(JSON.stringify({ status: "dispatching" }));
    return;
  }

  if (incoming.method === "POST" && url.pathname === "/v1/runs") {
    if (globalKillSwitch) {
      response.writeHead(503);
      response.end(JSON.stringify({ error: "Agent kill switch is active" }));
      return;
    }
    if (executionRuntime === "codex" && !(await codexAuthenticated())) {
      response.writeHead(503);
      response.end(
        JSON.stringify({
          error: "Codex subscription authentication required",
          setup: "docker compose --profile setup run --rm codex-login",
        }),
      );
      return;
    }
    let parsedBody: unknown;
    try {
      parsedBody = await body(incoming);
    } catch {
      response.writeHead(400);
      response.end(
        JSON.stringify({ error: "Request body must be valid JSON" }),
      );
      return;
    }
    const parsed = AgentRunRequestSchema.safeParse(parsedBody);
    if (!parsed.success) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error: "Invalid agent job",
          issues: parsed.error.issues,
        }),
      );
      return;
    }
    const organisationId = requestOrganisationId(incoming);
    if (!organisationId || organisationId !== parsed.data.organisationId) {
      response.writeHead(403);
      response.end(JSON.stringify({ error: "Organisation mismatch" }));
      return;
    }
    const idempotencyKey =
      incoming.headers["idempotency-key"]?.toString().trim() ||
      `api:${parsed.data.traceId}`;
    try {
      const accepted = await queueDirectRun(parsed.data, idempotencyKey);
      void runtime.dispatch();
      response.writeHead(202);
      response.end(
        JSON.stringify({
          runId: accepted.run.id,
          status: accepted.run.status,
          duplicate: accepted.duplicate,
          runtime: executionRuntime === "codex" ? "codex-subscription" : "mock",
          runtimeIsolation: "read-only-no-network",
        }),
      );
    } catch (error) {
      response.writeHead(409);
      response.end(
        JSON.stringify({
          error:
            error instanceof Error
              ? redactObservationText(error.message)
              : "Could not queue run",
        }),
      );
    }
    return;
  }

  const cancelMatch =
    incoming.method === "POST"
      ? url.pathname.match(/^\/v1\/runs\/([^/]+)\/cancel$/)
      : null;
  if (cancelMatch?.[1]) {
    const organisationId = requestOrganisationId(incoming);
    if (!organisationId) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Organisation header required" }));
      return;
    }
    const cancelled = await runtime.cancel(cancelMatch[1], organisationId);
    response.writeHead(cancelled ? 202 : 404);
    response.end(
      JSON.stringify({
        runId: cancelMatch[1],
        status: cancelled ? "cancelled" : "not_found",
      }),
    );
    return;
  }

  response.writeHead(404);
  response.end(JSON.stringify({ error: "Not found" }));
});

runtime.start();
server.listen(Number(process.env.AGENT_GATEWAY_PORT ?? 3002), "0.0.0.0");

async function shutdown() {
  runtime.stop();
  server.close();
  await closeDatabase();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
