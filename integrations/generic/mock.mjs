import { createServer } from "node:http";

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json",
    "x-muster-mock": "generic-rest",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://mock");
  if (url.pathname === "/health")
    return json(response, 200, {
      product: "Generic REST",
      mock: true,
      status: "healthy",
    });
  if (request.method === "GET" && url.pathname === "/alerts")
    return json(response, 200, {
      records: [
        {
          id: "synthetic-alert-1",
          title: "Synthetic connector verification",
          severity: "low",
          evidence: "Generated test data only",
        },
      ],
    });
  if (url.pathname === "/rate-limit")
    return json(
      response,
      429,
      { error: "synthetic rate limit" },
      { "retry-after": "1" },
    );
  if (url.pathname === "/malformed") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end("{");
  }
  return json(response, 404, { error: "Synthetic route not found" });
});

server.listen(Number(process.env.PORT ?? 4020), "0.0.0.0");
