import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  GovernedConnectorError,
  connectorPresets,
  decryptConnectorAuth,
  encryptConnectorAuth,
  executeGovernedQuery,
  executeGovernedActionRequest,
  publicConnectorConfiguration,
  renderTemplatePath,
  resolveSafeTarget,
  type ConnectorConfiguration,
  type QueryTemplate,
} from "./governed.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function server(handler: RequestListener): Promise<{ url: string }> {
  const instance = createServer(handler);
  servers.push(instance);
  await new Promise<void>((resolve) =>
    instance.listen(0, "127.0.0.1", resolve),
  );
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return { url: `http://127.0.0.1:${address.port}` };
}

function configuration(baseUrl: string): ConnectorConfiguration {
  return {
    product: "generic_rest",
    instanceId: "synthetic",
    displayName: "Synthetic connector",
    baseUrl,
    allowedHosts: ["127.0.0.1"],
    allowPrivateNetwork: true,
    testMode: true,
    auth: { type: "bearer", token: "never-return-this" },
    limits: {
      timeoutMs: 500,
      maxResponseBytes: 4_096,
      maxRecords: 3,
      maxPages: 2,
      requestsPerMinute: 60,
    },
  };
}

const template: QueryTemplate = {
  key: "synthetic.alerts",
  version: 1,
  displayName: "Synthetic alerts",
  method: "GET",
  pathTemplate: "/alerts/{tenant}",
  requiredCapability: "alerts.read",
  inputSchema: {
    type: "object",
    required: ["tenant"],
    properties: { tenant: { type: "string" } },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    required: ["records"],
    properties: {
      records: { type: "array" },
      cursor: { type: "string" },
    },
  },
  recordsPath: "records",
  cursor: { responsePath: "cursor", requestParameter: "cursor" },
};

describe("governed connector credentials", () => {
  it("encrypts, decrypts, rotates, and never projects secret values", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const first = encryptConnectorAuth(
      { type: "bearer", token: "first-secret" },
      key,
    );
    const second = encryptConnectorAuth(
      { type: "bearer", token: "rotated-secret" },
      key,
    );
    expect(first).not.toContain("first-secret");
    expect(second).not.toBe(first);
    expect(decryptConnectorAuth(second, key)).toEqual({
      type: "bearer",
      token: "rotated-secret",
    });
    expect(
      JSON.stringify(
        publicConnectorConfiguration({
          ...configuration("http://127.0.0.1"),
          auth: { type: "bearer", token: "never-project" },
        }),
      ),
    ).not.toContain("never-project");
  });
});

describe("governed connector egress", () => {
  it("ships bounded official UniFi read templates with API-key authentication", async () => {
    const mock = await server((request, response) => {
      expect(request.headers["x-api-key"]).toBe("synthetic-unifi-key");
      expect(request.url).toBe(
        "/v1/sites/site-1/clients?offset=0&limit=25&filter=",
      );
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          offset: 0,
          limit: 25,
          count: 1,
          totalCount: 1,
          data: [{ id: "synthetic-client", ipAddress: "192.0.2.10" }],
        }),
      );
    });
    const clientTemplate = connectorPresets.unifi?.find(
      (candidate) => candidate.key === "unifi.clients.list",
    );
    if (!clientTemplate) throw new Error("UniFi client preset required");
    const result = await executeGovernedQuery({
      configuration: {
        ...configuration(mock.url),
        product: "unifi",
        auth: {
          type: "api_key",
          headerName: "X-API-Key",
          token: "synthetic-unifi-key",
        },
      },
      auth: {
        type: "api_key",
        headerName: "X-API-Key",
        token: "synthetic-unifi-key",
      },
      template: clientTemplate,
      values: { siteId: "site-1", offset: 0, limit: 25, filter: "" },
    });
    expect(result).toMatchObject({
      data: [{ id: "synthetic-client", ipAddress: "192.0.2.10" }],
      metadata: { pages: 1, records: 1, truncated: false },
    });
  });

  it("denies private DNS without explicit test policy and denies host escape", async () => {
    await expect(
      resolveSafeTarget("https://127.0.0.1/test", {
        allowedHosts: ["127.0.0.1"],
        allowPrivateNetwork: false,
        testMode: false,
      }),
    ).rejects.toMatchObject({ code: "egress_denied" });
    await expect(
      resolveSafeTarget("https://localhost/test", {
        allowedHosts: ["approved.example"],
        allowPrivateNetwork: true,
        testMode: true,
      }),
    ).rejects.toMatchObject({ code: "egress_denied" });
    expect(() => renderTemplatePath("/safe/%2e%2e/admin", {})).toThrow(
      "Path traversal is denied",
    );
  });

  it("pins approved DNS, blocks redirects, and bounds pagination", async () => {
    let calls = 0;
    const mock = await server((request, response) => {
      expect(request.headers.authorization).toBe("Bearer never-return-this");
      calls += 1;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          records: [{ id: calls }],
          cursor: calls === 1 ? "next" : "",
        }),
      );
    });
    const result = await executeGovernedQuery({
      configuration: configuration(mock.url),
      auth: { type: "bearer", token: "never-return-this" },
      template,
      values: { tenant: "tenant-a" },
    });
    expect(result).toEqual({
      data: [{ id: 1 }, { id: 2 }],
      metadata: { pages: 2, records: 2, truncated: false },
    });
    expect(calls).toBe(2);

    const redirect = await server((_request, response) => {
      response.writeHead(302, { location: "http://example.com/" });
      response.end();
    });
    await expect(
      executeGovernedQuery({
        configuration: configuration(redirect.url),
        auth: { type: "none" },
        template: { ...template, cursor: undefined },
        values: { tenant: "tenant-a" },
      }),
    ).rejects.toMatchObject({ code: "egress_denied" });
  });
});

describe("governed connector failures", () => {
  it.each([
    [429, "rate_limited"],
    [503, "source_unavailable"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    const mock = await server((_request, response) => {
      response.writeHead(status, { "retry-after": "1" });
      response.end("{}");
    });
    await expect(
      executeGovernedQuery({
        configuration: configuration(mock.url),
        auth: { type: "none" },
        template,
        values: { tenant: "tenant-a" },
      }),
    ).rejects.toMatchObject({ code });
  });

  it("fails safely on malformed, oversized, and timed-out responses", async () => {
    const malformed = await server((_request, response) => response.end("{"));
    await expect(
      executeGovernedQuery({
        configuration: configuration(malformed.url),
        auth: { type: "none" },
        template,
        values: { tenant: "tenant-a" },
      }),
    ).rejects.toMatchObject({ code: "malformed_response" });

    const oversized = await server((_request, response) =>
      response.end(JSON.stringify({ records: [{ data: "x".repeat(5_000) }] })),
    );
    await expect(
      executeGovernedQuery({
        configuration: configuration(oversized.url),
        auth: { type: "none" },
        template,
        values: { tenant: "tenant-a" },
      }),
    ).rejects.toMatchObject({ code: "response_too_large" });

    const slow = await server(() => undefined);
    await expect(
      executeGovernedQuery({
        configuration: {
          ...configuration(slow.url),
          limits: { ...configuration(slow.url).limits, timeoutMs: 100 },
        },
        auth: { type: "none" },
        template,
        values: { tenant: "tenant-a" },
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects input and output outside versioned JSON Schemas", async () => {
    const mock = await server((_request, response) =>
      response.end(JSON.stringify({ wrong: true })),
    );
    await expect(
      executeGovernedQuery({
        configuration: configuration(mock.url),
        auth: { type: "none" },
        template,
        values: {},
      }),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      executeGovernedQuery({
        configuration: configuration(mock.url),
        auth: { type: "none" },
        template,
        values: { tenant: "tenant-a" },
      }),
    ).rejects.toMatchObject({ code: "malformed_response" });
  });
});

describe("governed connector actions", () => {
  it("executes only a typed action against the pinned approved target", async () => {
    const mock = await server(async (request, response) => {
      expect(request.method).toBe("PATCH");
      expect(request.headers.authorization).toBe("Bearer never-return-this");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({
        status: "contained",
      });
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: "synthetic-case",
          status: "contained",
        }),
      );
    });
    await expect(
      executeGovernedActionRequest({
        configuration: configuration(mock.url),
        auth: { type: "bearer", token: "never-return-this" },
        method: "PATCH",
        path: "/api/v1/cases/synthetic-case",
        body: { status: "contained" },
        schema: z.object({ id: z.string(), status: z.string() }),
      }),
    ).resolves.toEqual({ id: "synthetic-case", status: "contained" });
  });
});
