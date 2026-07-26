import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const agentId = "11111111-1111-4111-8111-111111111111";
const actions = [];
const json = (response, status, body) => {
  response.writeHead(status, {
    "content-type": "application/json",
    "x-muster-mock": "tawny",
  });
  response.end(JSON.stringify(body));
};
const body = async (request) =>
  JSON.parse(Buffer.concat(await Array.fromAsync(request)).toString("utf8"));

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://mock");
  if (url.pathname === "/health")
    return json(response, 200, {
      product: "Tawny",
      mock: true,
      status: "healthy",
    });
  if (request.method === "GET" && url.pathname === "/api/agents")
    return json(response, 200, [
      {
        id: agentId,
        hostname: "synthetic-tawny-endpoint",
        status: "online",
        mock: true,
      },
    ]);
  if (request.method === "POST" && url.pathname === "/api/hunts/run")
    return json(response, 200, {
      match_count: 1,
      matches: [
        {
          event_id: 1,
          agent_id: agentId,
          hostname: "synthetic-tawny-endpoint",
          event_type: "process_launch",
          occurred_at: "2026-07-26T06:21:08Z",
          received_at: "2026-07-26T06:21:11Z",
          payload: { image: "synthetic-process.exe" },
        },
      ],
      warnings: ["Synthetic local mock result"],
    });
  if (
    request.method === "GET" &&
    new RegExp(`^/api/agents/${agentId}/actions$`).test(url.pathname)
  )
    return json(response, 200, actions);
  if (
    request.method === "POST" &&
    new RegExp(`^/api/agents/${agentId}/actions$`).test(url.pathname)
  ) {
    const input = await body(request);
    const action = {
      id: randomUUID(),
      agent_id: agentId,
      action_type: input.action_type,
      status: "pending",
      payload: input.payload,
      mock: true,
    };
    actions.push(action);
    return json(response, 201, action);
  }
  return json(response, 404, {
    error: "Tawny mock route not found",
    mock: true,
  });
});
server.listen(Number(process.env.PORT ?? 4012), "0.0.0.0");
