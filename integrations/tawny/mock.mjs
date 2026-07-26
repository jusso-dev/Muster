import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const json = (response, status, body) => { response.writeHead(status, { "content-type": "application/json", "x-muster-mock": "tawny" }); response.end(JSON.stringify(body)); };
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://mock");
  if (url.pathname === "/health") return json(response, 200, { product: "Tawny", mock: true, status: "healthy" });
  if (request.method === "POST" && url.pathname === "/api/hunts/run") return json(response, 200, {
    match_count: 4,
    matches: [
      { event_id: 1, agent_id: "agent-ws-1042", hostname: "WS-1042", event_type: "process", occurred_at: "2026-07-26T06:21:08Z", received_at: "2026-07-26T06:21:11Z", payload: { image: "powershell.exe", encoded: true } },
      { event_id: 2, agent_id: "agent-ws-1042", hostname: "WS-1042", event_type: "network", occurred_at: "2026-07-26T06:21:19Z", received_at: "2026-07-26T06:21:22Z", payload: { destination: "203.0.113.44" } },
      { event_id: 3, agent_id: "agent-ws-1042", hostname: "WS-1042", event_type: "file", occurred_at: "2026-07-26T06:21:26Z", received_at: "2026-07-26T06:21:29Z", payload: { path: "C:\\Users\\jsmith\\update.dat" } },
      { event_id: 4, agent_id: "agent-ws-1042", hostname: "WS-1042", event_type: "session", occurred_at: "2026-07-26T06:17:40Z", received_at: "2026-07-26T06:17:42Z", payload: { user: "jsmith" } },
    ],
    warnings: ["Synthetic local mock result"],
  });
  if (request.method === "POST" && /^\/api\/agents\/[^/]+\/actions$/.test(url.pathname)) return json(response, 202, { id: randomUUID(), agent_id: "agent-ws-1042", action_type: "isolate_host", status: "queued", mock: true, contract_note: "Real inspected Tawny currently requires web-user Admin authentication for action creation." });
  return json(response, 404, { error: "Tawny mock route not found", mock: true });
});
server.listen(Number(process.env.PORT ?? 4012), "0.0.0.0");
