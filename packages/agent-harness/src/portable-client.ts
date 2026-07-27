import { z } from "zod";
import {
  AgentHarnessInvokeSchema,
  AgentHarnessManifestSchema,
  AgentHarnessRunSchema,
  type AgentHarnessInvoke,
  type AgentHarnessManifest,
  type AgentHarnessRun,
} from "@muster/contracts";

type HarnessResponse<T> = { data: T; traceId?: string | undefined };

const harnessResponse = <T extends z.ZodType>(schema: T) =>
  z.object({ data: schema, traceId: z.string().optional() });

export type HarnessHeaders = HeadersInit | (() => HeadersInit);

export type AgentHarnessHttpClientOptions = {
  baseUrl: string;
  headers?: HarnessHeaders;
  fetch?: typeof globalThis.fetch;
};

export class AgentHarnessHttpError extends Error {
  constructor(readonly status: number) {
    super(`Agent harness request failed with HTTP ${status}`);
  }
}

/**
 * Authenticated portable client for CLI, MCP, Hermes and custom tools. It only
 * forwards caller credentials to the authoritative HTTP harness; it never
 * creates identities, capabilities, prompts, or connector credentials.
 */
export class AgentHarnessHttpClient {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(private readonly options: AgentHarnessHttpClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async manifest(): Promise<AgentHarnessManifest[]> {
    return this.request(
      "/api/v1/agent-harness/manifests",
      { method: "GET" },
      harnessResponse(z.array(AgentHarnessManifestSchema)),
    );
  }

  async invoke(
    input: AgentHarnessInvoke,
    idempotencyKey: string,
  ): Promise<AgentHarnessRun> {
    return this.request(
      "/api/v1/agent-harness/invocations",
      {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify(AgentHarnessInvokeSchema.parse(input)),
      },
      harnessResponse(AgentHarnessRunSchema),
    );
  }

  async read(runId: string): Promise<AgentHarnessRun> {
    return this.request(
      `/api/v1/agent-harness/runs/${encodeURIComponent(runId)}`,
      { method: "GET" },
      harnessResponse(AgentHarnessRunSchema),
    );
  }

  async cancel(runId: string): Promise<unknown> {
    return this.request(
      `/api/v1/agent-harness/runs/${encodeURIComponent(runId)}`,
      { method: "DELETE" },
      harnessResponse(z.unknown()),
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<HarnessResponse<T>>,
  ): Promise<T> {
    const configuredHeaders =
      typeof this.options.headers === "function"
        ? this.options.headers()
        : this.options.headers;
    const headers = new Headers(configuredHeaders);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    for (const [name, value] of new Headers(init.headers))
      headers.set(name, value);
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      ...init,
      headers,
    });
    if (!response.ok) throw new AgentHarnessHttpError(response.status);
    return schema.parse(await response.json()).data;
  }
}
