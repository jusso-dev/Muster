import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AgentHarnessRun } from "@muster/contracts";
import { runHarnessCli } from "./cli.ts";
import { createAgentHarnessMcpServer } from "./mcp.ts";
import { AgentHarnessHttpClient } from "./portable-client.ts";

const run: AgentHarnessRun = {
  protocolVersion: "muster.agent-harness/v1",
  runId: "00000000-0000-4000-8000-000000000001",
  status: "queued",
  agentKey: "Jessie",
  correlationId: "synthetic-correlation",
  duplicate: false,
  result: null,
};

describe("portable governed harness adapters", () => {
  it("forwards opaque caller credentials and validates authoritative HTTP envelopes", async () => {
    const requests: Array<{ url: string; headers: Headers; body: unknown }> =
      [];
    const client = new AgentHarnessHttpClient({
      baseUrl: "https://muster.example/ignored/path",
      headers: { authorization: "Bearer synthetic-session" },
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body ?? "null")),
        });
        return Response.json(
          { data: run, traceId: "synthetic-trace" },
          { status: 202 },
        );
      },
    });

    await expect(
      client.invoke(
        {
          agentKey: "Jessie",
          mode: "hermes",
          input: { prompt: "Synthetic bounded request" },
        },
        "synthetic-idempotency",
      ),
    ).resolves.toEqual(run);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "https://muster.example/api/v1/agent-harness/invocations",
      body: {
        agentKey: "Jessie",
        mode: "hermes",
        input: { prompt: "Synthetic bounded request" },
      },
    });
    expect(requests[0]!.headers.get("authorization")).toBe(
      "Bearer synthetic-session",
    );
    expect(requests[0]!.headers.get("idempotency-key")).toBe(
      "synthetic-idempotency",
    );
  });

  it("exposes list and invoke through a real in-memory MCP session", async () => {
    const invocations: Array<{ mode: string; idempotencyKey: string }> = [];
    const server = createAgentHarnessMcpServer({
      manifest: async () => [
        {
          protocolVersion: "muster.agent-harness/v1",
          key: "Jessie",
          version: "synthetic-v1",
          name: "Jessie",
          description: "Synthetic governed agent",
          invocationModes: ["mcp"],
          inputSchema: "muster.agent-harness.input/v1",
          outputSchema: "muster.agent.structured/v1",
          requiredCapabilities: ["agents.invoke"],
          approvalBehavior: "none",
          lifecycle: "active",
        },
      ],
      invoke: async (input, idempotencyKey) => {
        invocations.push({ mode: input.mode, idempotencyKey });
        return run;
      },
      read: async () => run,
      cancel: async () => ({ status: "requested" }),
    });
    const client = new Client({ name: "synthetic-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["muster_agents_list", "muster_agents_invoke"]),
    );
    const invoked = await client.request(
      {
        method: "tools/call",
        params: {
          name: "muster_agents_invoke",
          arguments: {
            agentKey: "Jessie",
            prompt: "Synthetic MCP request",
            idempotencyKey: "synthetic-mcp-idempotency",
          },
        },
      },
      CallToolResultSchema,
    );
    expect(invoked.isError).not.toBe(true);
    expect(invocations).toEqual([
      { mode: "mcp", idempotencyKey: "synthetic-mcp-idempotency" },
    ]);
    await client.close();
    await server.close();
  });

  it("uses CLI mode and never writes credentials into output", async () => {
    const output: string[] = [];
    const invocations: Array<{ mode: string; idempotencyKey: string }> = [];
    const client = {
      manifest: async () => [],
      invoke: async (input: { mode: string }, idempotencyKey: string) => {
        invocations.push({ mode: input.mode, idempotencyKey });
        return run;
      },
      read: async () => run,
      cancel: async () => ({ status: "requested" }),
    } as unknown as AgentHarnessHttpClient;

    await runHarnessCli(
      [
        "invoke",
        "--agent=Jessie",
        "--prompt=Synthetic CLI request",
        "--idempotency=synthetic-cli-idempotency",
      ],
      client,
      { log: (value) => output.push(value) },
    );
    expect(invocations).toEqual([
      { mode: "cli", idempotencyKey: "synthetic-cli-idempotency" },
    ]);
    expect(output.join("\n")).not.toContain("MUSTER_HARNESS_");
  });
});
