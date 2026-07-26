import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const cases = new Map();
const comments = new Map();
const observables = new Map();
const json = (response, status, body) => {
  response.writeHead(status, {
    "content-type": "application/json",
    "x-muster-mock": "kelpie",
  });
  response.end(JSON.stringify(body));
};
const body = async (request) =>
  JSON.parse(Buffer.concat(await Array.fromAsync(request)).toString("utf8"));

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://mock");
  if (url.pathname === "/health")
    return json(response, 200, {
      product: "Kelpie",
      mock: true,
      status: "healthy",
    });
  if (request.method === "GET" && url.pathname === "/api/v1/cases")
    return json(response, 200, { cases: [...cases.values()] });
  if (request.method === "POST" && url.pathname === "/api/v1/cases") {
    const input = await body(request);
    const id = randomUUID();
    const item = {
      id,
      caseNumber: `KP-SYNTH-${String(cases.size + 1).padStart(4, "0")}`,
      ...input,
      status: "open",
      version: 1,
      mock: true,
    };
    cases.set(id, item);
    comments.set(id, []);
    observables.set(id, []);
    return json(response, 201, {
      id: item.id,
      caseNumber: item.caseNumber,
    });
  }
  const commentMatch = url.pathname.match(
    /^\/api\/v1\/cases\/([^/]+)\/comments$/,
  );
  if (commentMatch) {
    const caseId = decodeURIComponent(commentMatch[1]);
    const values = comments.get(caseId);
    if (!values) return json(response, 404, { error: "Mock case not found" });
    if (request.method === "GET")
      return json(response, 200, { comments: values });
    if (request.method === "POST") {
      const item = { id: randomUUID(), ...(await body(request)), mock: true };
      values.push(item);
      return json(response, 201, item);
    }
  }
  const observableMatch = url.pathname.match(
    /^\/api\/v1\/cases\/([^/]+)\/observables$/,
  );
  if (observableMatch) {
    const caseId = decodeURIComponent(observableMatch[1]);
    const values = observables.get(caseId);
    if (!values) return json(response, 404, { error: "Mock case not found" });
    if (request.method === "GET")
      return json(response, 200, { observables: values });
    if (request.method === "POST") {
      const item = { id: randomUUID(), ...(await body(request)), mock: true };
      values.push(item);
      return json(response, 201, { id: item.id });
    }
  }
  const caseMatch = url.pathname.match(/^\/api\/v1\/cases\/([^/]+)$/);
  if (caseMatch) {
    const caseId = decodeURIComponent(caseMatch[1]);
    const item = cases.get(caseId);
    if (!item) return json(response, 404, { error: "Mock case not found" });
    if (request.method === "GET")
      return json(response, 200, {
        ...item,
        observables: observables.get(caseId) ?? [],
        recent_timeline: comments.get(caseId) ?? [],
      });
    if (request.method === "PATCH") {
      Object.assign(item, await body(request), { version: item.version + 1 });
      return json(response, 200, item);
    }
  }
  return json(response, 404, {
    error: "Kelpie mock route not found",
    mock: true,
  });
});
server.listen(Number(process.env.PORT ?? 4011), "0.0.0.0");
