import { z } from "zod";

export * from "./governed.ts";
export * from "./actions.ts";

export interface ConnectorOptions {
  baseUrl: string;
  token: string;
  instanceId: string;
  timeoutMs?: number;
  mock?: boolean;
}

export class IntegrationProblem extends Error {
  override readonly name = "IntegrationProblem";
  constructor(
    readonly product: string,
    readonly operation: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

abstract class HttpConnector {
  protected constructor(
    protected readonly product: string,
    protected readonly options: ConnectorOptions,
  ) {}

  protected async request<T>(
    operation: string,
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
    idempotencyKey?: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 10_000,
    );
    try {
      const response = await fetch(new URL(path, this.options.baseUrl), {
        ...init,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
          "user-agent": "muster/0.1",
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          ...init.headers,
        },
      });
      if (!response.ok) {
        throw new IntegrationProblem(
          this.product,
          operation,
          response.status,
          `${this.product} returned HTTP ${response.status}`,
        );
      }
      if (response.status === 204) return schema.parse(undefined);
      return schema.parse(await response.json());
    } catch (error) {
      if (error instanceof IntegrationProblem) throw error;
      throw new IntegrationProblem(
        this.product,
        operation,
        null,
        error instanceof Error ? error.message : "Unknown connector failure",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const KelpieCaseSchema = z.object({
  id: z.string(),
  caseNumber: z.string(),
  title: z.string().optional(),
  summary: z.string().optional(),
  severity: z.string().optional(),
  status: z.string().optional(),
  version: z.number().int().optional(),
  observables: z.array(z.unknown()).optional(),
  tasks: z.array(z.unknown()).optional(),
  recent_timeline: z.array(z.unknown()).optional(),
});

export class KelpieConnector extends HttpConnector {
  constructor(options: ConnectorOptions) {
    super("kelpie", options);
  }

  createCase(
    draft: {
      title: string;
      summary: string;
      severity: string;
      tlp: string;
      pap: string;
      classification: string;
      tags?: string[];
    },
    idempotencyKey: string,
  ) {
    return this.request(
      "case.create",
      "/api/v1/cases",
      z.object({ id: z.string(), caseNumber: z.string() }),
      { method: "POST", body: JSON.stringify(draft) },
      idempotencyKey,
    );
  }

  getCase(id: string) {
    return this.request(
      "case.get",
      `/api/v1/cases/${encodeURIComponent(id)}`,
      KelpieCaseSchema,
    );
  }

  addComment(caseId: string, body: string, idempotencyKey: string) {
    return this.request(
      "comment.create",
      `/api/v1/cases/${encodeURIComponent(caseId)}/comments`,
      z.object({ id: z.string() }).passthrough(),
      { method: "POST", body: JSON.stringify({ body }) },
      idempotencyKey,
    );
  }
}

export const TawnyHuntResponseSchema = z
  .object({
    match_count: z.number().int().nonnegative(),
    matches: z.array(
      z.object({
        event_id: z.number().int().nonnegative(),
        agent_id: z.string(),
        hostname: z.string(),
        event_type: z.string(),
        occurred_at: z.string(),
        received_at: z.string(),
        payload: z.unknown(),
      }),
    ),
    warnings: z.array(z.string()),
  })
  .transform((response) => ({
    matchCount: response.match_count,
    matches: response.matches.map((match) => ({
      eventId: match.event_id,
      agentId: match.agent_id,
      hostname: match.hostname,
      eventType: match.event_type,
      occurredAt: match.occurred_at,
      receivedAt: match.received_at,
      payload: match.payload,
    })),
    warnings: response.warnings,
  }));

export class TawnyConnector extends HttpConnector {
  constructor(options: ConnectorOptions) {
    super("tawny", options);
  }

  runHunt(query: string, limit = 500) {
    if (limit < 1 || limit > 1_000)
      throw new Error("Tawny hunt limit out of range");
    return this.request("hunt.run", "/api/hunts/run", TawnyHuntResponseSchema, {
      method: "POST",
      body: JSON.stringify({ query, limit }),
    });
  }

  requestResponseAction(
    agentId: string,
    actionType: "kill_process" | "isolate_host",
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ) {
    return this.request(
      "response.create",
      `/api/agents/${encodeURIComponent(agentId)}/actions`,
      z
        .object({
          id: z.string(),
          agent_id: z.string(),
          action_type: z.string(),
          status: z.string(),
        })
        .transform((response) => ({
          id: response.id,
          agentId: response.agent_id,
          actionType: response.action_type,
          status: response.status,
        })),
      {
        method: "POST",
        body: JSON.stringify({ action_type: actionType, payload }),
      },
      idempotencyKey,
    );
  }
}

export const BowerOverviewSchema = z.object({
  totalCollectors: z.number().int().nonnegative(),
  pendingApproval: z.number().int().nonnegative(),
  unhealthyCollectors: z.number().int().nonnegative(),
  staleCollectors: z.number().int().nonnegative(),
  totalQueueDepth: z.number().int().nonnegative(),
  sourcesReporting: z.number().int().nonnegative(),
  sourcesDegraded: z.number().int().nonnegative(),
  exceptions: z.array(z.unknown()),
});

export class BowerConnector extends HttpConnector {
  constructor(options: ConnectorOptions) {
    super("bower", options);
  }

  overview() {
    return this.request("overview.get", "/api/overview", BowerOverviewSchema);
  }

  collectors(status?: string) {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request(
      "collectors.list",
      `/api/collectors${query}`,
      z.array(
        z.object({
          id: z.string(),
          machineName: z.string(),
          environment: z.string(),
          version: z.string(),
          status: z.string(),
          lastSeenAt: z.string(),
          queueDepth: z.number(),
          deliveryStatus: z.string(),
          sources: z.array(z.unknown()),
          outputs: z.array(z.unknown()),
        }),
      ),
    );
  }
}
