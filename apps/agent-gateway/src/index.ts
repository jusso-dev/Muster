import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { AgentInvestigationJobSchema } from "@muster/contracts";
import { jsonLog } from "@muster/config";

const activeRuns = new Map<string, AbortController>();
let killSwitch = process.env.AGENT_KILL_SWITCH === "true";

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://agent-gateway.local");
  response.setHeader("content-type", "application/json");
  if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/ready")) {
    response.writeHead(killSwitch ? 503 : 200);
    response.end(JSON.stringify({ status: killSwitch ? "disabled" : "ready", runtimes: ["mock", "mcp", "acp"], activeRuns: activeRuns.size }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/runs") {
    if (killSwitch) { response.writeHead(503); response.end(JSON.stringify({ error: "Agent kill switch is active" })); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = AgentInvestigationJobSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) { response.writeHead(400); response.end(JSON.stringify({ error: "Invalid agent job", issues: parsed.error.issues })); return; }
    const runId = randomUUID();
    activeRuns.set(runId, new AbortController());
    jsonLog("info", "agent.run.accepted", { runId, organisationId: parsed.data.organisationId, traceId: parsed.data.traceId });
    response.writeHead(202); response.end(JSON.stringify({ runId, status: "queued", runtimeIsolation: "mock-sandbox" }));
    return;
  }
  if (request.method === "POST" && url.pathname.endsWith("/cancel")) {
    const runId = url.pathname.split("/")[3];
    const controller = runId ? activeRuns.get(runId) : undefined;
    controller?.abort();
    if (runId) activeRuns.delete(runId);
    response.writeHead(controller ? 202 : 404); response.end(JSON.stringify({ runId, status: controller ? "cancelled" : "not_found" }));
    return;
  }
  response.writeHead(404); response.end(JSON.stringify({ error: "Not found" }));
});
server.listen(Number(process.env.AGENT_GATEWAY_PORT ?? 3002), "0.0.0.0");
