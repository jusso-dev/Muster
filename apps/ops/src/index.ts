/**
 * Muster Ops HTTP surface for Slack bots and automation.
 * No chat UI — chat is in Slack; this is tools + JSON.
 *
 * Mastra agent tools are the same functions as REST routes below.
 */
import { createServer } from "node:http";
import {
  buildBriefing,
  createClientsFromEnv,
  getCaseQueue,
  getFleetSnapshot,
  loadOpsEnv,
} from "@muster/ops";
import { mastra, opsTools } from "./mastra/index.ts";

const port = Number(process.env.MUSTER_OPS_PORT ?? 3010);

function json(response: import("node:http").ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(payload);
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function requireToken(
  request: import("node:http").IncomingMessage,
): boolean {
  const expected = process.env.MUSTER_OPS_TOKEN?.trim();
  if (!expected) return true;
  const header = request.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return bearer === expected;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const path = url.pathname;

    if (path === "/health" || path === "/api/v1/health") {
      json(response, 200, { status: "ok", product: "muster-ops" });
      return;
    }

    if (!requireToken(request) && path.startsWith("/api/")) {
      json(response, 401, { error: "unauthorized" });
      return;
    }

    const env = loadOpsEnv();
    const clients = createClientsFromEnv(env);

    if (request.method === "GET" && path === "/api/v1/briefing") {
      json(response, 200, await buildBriefing(env, clients));
      return;
    }

    if (request.method === "GET" && path === "/api/v1/fleet") {
      if (!clients.tawny) {
        json(response, 503, { error: "TAWNY_BASE_URL not configured" });
        return;
      }
      const snapshot = await getFleetSnapshot(clients.tawny, env);
      const status = url.searchParams.get("status");
      const hosts =
        status && status !== "all"
          ? snapshot.hosts.filter((h) => h.status === status)
          : snapshot.hosts;
      json(response, 200, { ...snapshot, hosts });
      return;
    }

    if (request.method === "GET" && path === "/api/v1/cases/open") {
      if (!clients.kelpie) {
        json(response, 503, { error: "KELPIE_BASE_URL not configured" });
        return;
      }
      json(response, 200, await getCaseQueue(clients.kelpie, env));
      return;
    }

    if (request.method === "GET" && path === "/api/v1/brolga/stats") {
      if (!clients.brolga) {
        json(response, 503, { error: "BROLGA_BASE_URL not configured" });
        return;
      }
      const [health, stats] = await Promise.all([
        clients.brolga.health(),
        clients.brolga.stats(),
      ]);
      json(response, 200, { health, stats });
      return;
    }

    if (request.method === "POST" && path === "/api/v1/ti/lookup") {
      if (!clients.brolga) {
        json(response, 503, { error: "BROLGA_BASE_URL not configured" });
        return;
      }
      const body = (await readJson(request)) as { kind?: string; value?: string };
      if (!body.kind || !body.value) {
        json(response, 400, { error: "kind and value required" });
        return;
      }
      const pack = await clients.brolga.context({
        kind: body.kind,
        value: body.value,
      });
      json(response, 200, {
        disposition: pack.disposition ?? null,
        confidence: pack.confidence ?? null,
        pack,
      });
      return;
    }

    /** Slack / bot agent entry: natural language → Mastra agent with tools */
    if (request.method === "POST" && path === "/api/v1/agent/generate") {
      const body = (await readJson(request)) as { message?: string };
      if (!body.message?.trim()) {
        json(response, 400, { error: "message required" });
        return;
      }
      const agent = mastra.getAgentById("muster-ops");
      const result = await agent.generate(body.message.trim());
      json(response, 200, {
        text: result.text,
        // tool results vary by Mastra version; pass through best-effort
        toolResults: (result as { toolResults?: unknown }).toolResults ?? null,
      });
      return;
    }

    if (request.method === "GET" && path === "/api/v1/tools") {
      json(response, 200, {
        note: "Mastra tools for Slack agent wiring",
        tools: Object.keys(opsTools),
        mastra: "https://mastra.ai/",
      });
      return;
    }

    json(response, 404, {
      error: "not_found",
      routes: [
        "GET /health",
        "GET /api/v1/briefing",
        "GET /api/v1/fleet?status=",
        "GET /api/v1/cases/open",
        "GET /api/v1/brolga/stats",
        "POST /api/v1/ti/lookup",
        "POST /api/v1/agent/generate",
        "GET /api/v1/tools",
      ],
    });
  } catch (error) {
    json(response, 500, {
      error: error instanceof Error ? error.message : "internal_error",
    });
  }
});

server.listen(port, () => {
  process.stdout.write(
    `muster-ops listening on :${port} (REST + Mastra agent; chat is in Slack)\n`,
  );
});
