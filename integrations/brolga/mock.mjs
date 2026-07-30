import { createServer } from "node:http";

const json = (response, status, body) => {
  response.writeHead(status, {
    "content-type": "application/json",
    "x-muster-mock": "brolga",
  });
  response.end(JSON.stringify(body));
};
const body = async (request) =>
  JSON.parse(Buffer.concat(await Array.fromAsync(request)).toString("utf8"));

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://mock");
  if (url.pathname === "/health")
    return json(response, 200, {
      product: "Brolga",
      mock: true,
      status: "healthy",
    });
  if (request.method === "POST" && url.pathname === "/api/v1/context") {
    const input = await body(request);
    const subject = input.subject ?? { kind: "ip", value: "203.0.113.42" };
    return json(response, 200, {
      schema_version: "brolga.context_pack/1.0",
      subject,
      observable_id: "observable:synthetic-brolga-1",
      disposition: "suspicious",
      entities: [
        {
          id: "entity:synthetic-1",
          kind: "report",
          name: "Synthetic C2 infrastructure",
        },
      ],
      claims: [
        {
          predicate: "disposition",
          object: "suspicious",
          status: "active",
        },
      ],
      relationships: [],
      evidence: [{ source_object_id: "source:synthetic-brolga" }],
      gaps: ["no live sightings in mock"],
      exclusions: [],
      mock: true,
    });
  }
  return json(response, 404, {
    error: "Brolga mock route not found",
    mock: true,
  });
});
server.listen(Number(process.env.PORT ?? 4014), "0.0.0.0");
