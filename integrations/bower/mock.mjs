import { createServer } from "node:http";

const collectors = [
  { id: "col-1", machineName: "legacy-portal-au-01", environment: "production", version: "1.4.2", status: "active", lastSeenAt: "2026-07-26T06:41:48Z", queueDepth: 0, deliveryStatus: "healthy", sources: [{ name: "legacy-portal", coverage: "3/3" }], outputs: [{ type: "sentinel", status: "delivering" }] },
  { id: "col-2", machineName: "legacy-finance-au-02", environment: "production", version: "1.4.2", status: "active", lastSeenAt: "2026-07-26T06:08:00Z", queueDepth: 284, deliveryStatus: "degraded", sources: [{ name: "finance", coverage: "4/5" }], outputs: [{ type: "sentinel", status: "delayed" }] },
];
const json = (response, status, body) => { response.writeHead(status, { "content-type": "application/json", "x-muster-mock": "bower" }); response.end(JSON.stringify(body)); };
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://mock");
  if (url.pathname === "/health") return json(response, 200, { product: "Bower", mock: true, status: "degraded", limitation: "Heartbeat does not prove destination queryability." });
  if (url.pathname === "/api/overview") return json(response, 200, { totalCollectors: 18, pendingApproval: 1, unhealthyCollectors: 1, staleCollectors: 1, totalQueueDepth: 284, sourcesReporting: 42, sourcesDegraded: 2, exceptions: [{ collector: "legacy-finance-au-02", reason: "stale" }] });
  if (url.pathname === "/api/collectors") return json(response, 200, collectors);
  return json(response, 404, { error: "Bower mock route not found", mock: true });
});
server.listen(Number(process.env.PORT ?? 4013), "0.0.0.0");
