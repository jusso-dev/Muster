import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { redactObservationText } from "@muster/config";
import { closeDatabase, database } from "@muster/database";
import { createMusterMcpServer, resolveInstallation } from "@muster/mcp";
import { checkDatabaseHealth } from "./health.ts";
import { gracefulShutdown } from "./shutdown.ts";

const db = database();

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function requestTraceId(request: IncomingMessage): string {
  const header = request.headers["x-trace-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return redactObservationText(value ?? randomUUID(), { maxStringLength: 200 });
}

function respondJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://mcp-server.local");

  if (request.method === "GET" && url.pathname === "/health") {
    const healthy = await checkDatabaseHealth(db);
    respondJson(response, healthy ? 200 : 503, {
      status: healthy ? "ready" : "not_ready",
      authority: "postgresql",
    });
    return;
  }

  if (url.pathname !== "/mcp") {
    respondJson(response, 404, { error: "Not found" });
    return;
  }

  // A missing, malformed, revoked, or cross-organisation credential all fail
  // the same way here: a generic 401 that never reveals which case applied.
  const token = bearerToken(request.headers.authorization);
  const context = token ? await resolveInstallation(db, token) : null;
  if (!context) {
    respondJson(response, 401, { error: "Unauthorised" });
    return;
  }

  const mcpServer = createMusterMcpServer({
    db,
    context,
    traceId: requestTraceId(request),
  });
  // Omitting `sessionIdGenerator` (rather than setting it to `undefined`)
  // selects stateless mode under `exactOptionalPropertyTypes`; every request
  // is authorised independently by its own bearer token regardless.
  const transport = new StreamableHTTPServerTransport({});
  response.on("close", () => void transport.close());
  try {
    // The installed SDK's concrete transport class types `onclose`/`onerror`
    // as `(() => void) | undefined` while `Transport` declares them as
    // optional `() => void`; those are equivalent at runtime but disagree
    // under `exactOptionalPropertyTypes`, hence the assertion.
    await mcpServer.connect(transport as unknown as Transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    console.error(
      "mcp.request.failed",
      redactObservationText(error instanceof Error ? error.message : "unknown"),
    );
    if (!response.headersSent)
      respondJson(response, 500, { error: "Request failed" });
  }
});

// Kelpie tool calls poll for up to KELPIE_POLL_OPTIONS.timeoutMs (8s) inside
// the request; these bound the socket/request lifecycle around that with
// headroom, so a burst of concurrent bounded polls can't hold connections
// open indefinitely instead of being bounded like everything else here.
server.requestTimeout = 15_000;
server.headersTimeout = 12_000;
server.keepAliveTimeout = 5_000;

server.listen(Number(process.env.MCP_SERVER_PORT ?? 3003), "0.0.0.0");

async function shutdown() {
  await gracefulShutdown(server, closeDatabase);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
