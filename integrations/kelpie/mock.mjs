import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const cases = new Map([["KP-2026-0042", { id: "case_mock_42", caseNumber: "KP-2026-0042", title: "Credential access and endpoint execution", severity: "critical", status: "containment", version: 3 }]]);
const json = (response, status, body) => { response.writeHead(status, { "content-type": "application/json", "x-muster-mock": "kelpie" }); response.end(JSON.stringify(body)); };
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://mock");
  if (url.pathname === "/health") return json(response, 200, { product: "Kelpie", mock: true, status: "healthy" });
  if (request.method === "POST" && url.pathname === "/api/v1/cases") {
    const body = JSON.parse(Buffer.concat(await Array.fromAsync(request)).toString("utf8"));
    const number = `KP-2026-${String(cases.size + 42).padStart(4, "0")}`;
    const item = { id: randomUUID(), caseNumber: number, ...body, status: "draft", version: 1, mock: true };
    cases.set(number, item);
    return json(response, 201, item);
  }
  const match = url.pathname.match(/^\/api\/v1\/cases\/([^/]+)$/);
  if (request.method === "GET" && match) {
    const item = cases.get(decodeURIComponent(match[1]));
    return item ? json(response, 200, item) : json(response, 404, { error: "Mock case not found" });
  }
  if (request.method === "POST" && /\/comments$/.test(url.pathname)) return json(response, 201, { id: randomUUID(), mock: true });
  return json(response, 404, { error: "Kelpie mock route not found", mock: true });
});
server.listen(Number(process.env.PORT ?? 4011), "0.0.0.0");
