import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const json = (response, status, body) => { response.writeHead(status, { "content-type": "application/json", "x-muster-mock": "tawny" }); response.end(JSON.stringify(body)); };
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://mock");
  if (url.pathname === "/health") return json(response, 200, { product: "Tawny", mock: true, status: "healthy" });
  if (request.method === "POST" && url.pathname === "/api/hunts/run") return json(response, 200, {
    matchCount: 4,
    matches: [
      { eventId: "evt-process-1", agentId: "agent-ws-1042", hostname: "WS-1042", eventType: "process", occurredAt: "2026-07-26T06:21:08Z", receivedAt: "2026-07-26T06:21:11Z", payload: { image: "powershell.exe", encoded: true } },
      { eventId: "evt-network-1", agentId: "agent-ws-1042", hostname: "WS-1042", eventType: "network", occurredAt: "2026-07-26T06:21:19Z", receivedAt: "2026-07-26T06:21:22Z", payload: { destination: "203.0.113.44" } },
      { eventId: "evt-file-1", agentId: "agent-ws-1042", hostname: "WS-1042", eventType: "file", occurredAt: "2026-07-26T06:21:26Z", receivedAt: "2026-07-26T06:21:29Z", payload: { path: "C:\\Users\\jsmith\\update.dat" } },
      { eventId: "evt-session-1", agentId: "agent-ws-1042", hostname: "WS-1042", eventType: "session", occurredAt: "2026-07-26T06:17:40Z", receivedAt: "2026-07-26T06:17:42Z", payload: { user: "jsmith" } },
    ],
    warnings: ["Synthetic local mock result"],
  });
  if (request.method === "POST" && /^\/api\/agents\/[^/]+\/actions$/.test(url.pathname)) return json(response, 202, { id: randomUUID(), agentId: "agent-ws-1042", actionType: "isolate_host", status: "queued", mock: true, contractNote: "Real inspected Tawny currently requires web-user Admin authentication for action creation." });
  return json(response, 404, { error: "Tawny mock route not found", mock: true });
});
server.listen(Number(process.env.PORT ?? 4012), "0.0.0.0");
