import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  AgentHarnessHttpClient,
  AgentHarnessHttpError,
  type AgentHarnessHttpClientOptions,
} from "./portable-client.ts";

export type HarnessMcpClient = Pick<
  AgentHarnessHttpClient,
  "manifest" | "invoke" | "read" | "cancel"
>;

function content(value: unknown) {
  return [{ type: "text" as const, text: JSON.stringify(value) }];
}

function failure(error: unknown) {
  const message =
    error instanceof AgentHarnessHttpError
      ? `Authoritative harness rejected request (${error.status}).`
      : "Authoritative harness request failed.";
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function createAgentHarnessMcpServer(client: HarnessMcpClient) {
  const server = new McpServer({
    name: "muster-agent-harness",
    version: "0.1.0",
  });
  server.registerTool(
    "muster_agents_list",
    {
      description:
        "List active Muster agents current authenticated actor may discover and invoke.",
    },
    async () => {
      try {
        return { content: content(await client.manifest()) };
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "muster_agents_invoke",
    {
      description:
        "Queue a governed agent run. Idempotency key is required for reconnect-safe calls.",
      inputSchema: {
        agentKey: z.string().min(1).max(120),
        prompt: z.string().min(1).max(4_000),
        idempotencyKey: z.string().min(1).max(200),
        correlationId: z.string().min(8).max(160).optional(),
        roomId: z.string().uuid().optional(),
        investigationId: z.string().uuid().optional(),
        taskId: z.string().uuid().optional(),
        caseId: z.string().min(1).max(200).optional(),
      },
    },
    async ({ idempotencyKey, agentKey, prompt, correlationId, ...context }) => {
      try {
        return {
          content: content(
            await client.invoke(
              {
                agentKey,
                mode: "mcp",
                input: { prompt, ...context },
                ...(correlationId ? { correlationId } : {}),
              },
              idempotencyKey,
            ),
          ),
        };
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "muster_agents_get",
    {
      description:
        "Read a governed agent run scoped to current authenticated actor.",
      inputSchema: { runId: z.string().uuid() },
    },
    async ({ runId }) => {
      try {
        return { content: content(await client.read(runId)) };
      } catch (error) {
        return failure(error);
      }
    },
  );
  server.registerTool(
    "muster_agents_cancel",
    {
      description:
        "Request capability-checked cancellation of a governed agent run.",
      inputSchema: { runId: z.string().uuid() },
    },
    async ({ runId }) => {
      try {
        return { content: content(await client.cancel(runId)) };
      } catch (error) {
        return failure(error);
      }
    },
  );
  return server;
}

export function clientOptionsFromEnvironment(
  environment = process.env,
): AgentHarnessHttpClientOptions {
  const baseUrl = environment.MUSTER_HARNESS_URL;
  const authorization = environment.MUSTER_HARNESS_AUTHORIZATION;
  const cookie = environment.MUSTER_HARNESS_COOKIE;
  if (!baseUrl || (!authorization && !cookie))
    throw new Error(
      "Set MUSTER_HARNESS_URL and MUSTER_HARNESS_AUTHORIZATION or MUSTER_HARNESS_COOKIE.",
    );
  return {
    baseUrl,
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(cookie ? { cookie } : {}),
    },
  };
}

async function main() {
  const server = createAgentHarnessMcpServer(
    new AgentHarnessHttpClient(clientOptionsFromEnvironment()),
  );
  await server.connect(new StdioServerTransport());
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file:${process.argv[1]}`).href
)
  void main();
