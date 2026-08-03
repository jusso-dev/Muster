import { z } from "zod";
import { type HttpClientOptions, upstreamJson } from "../http.ts";

const AgentSchema = z
  .object({
    id: z.string(),
    hostname: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
    last_seen_at: z.string().optional().nullable(),
    lastSeenAt: z.string().optional().nullable(),
    last_heartbeat_at: z.string().optional().nullable(),
    platform: z.string().optional().nullable(),
    version: z.string().optional().nullable(),
    tags: z.array(z.string()).optional().nullable(),
  })
  .passthrough();

const AlertSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    agent_id: z.string().optional().nullable(),
    agentId: z.string().optional().nullable(),
    hostname: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    severity: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
    created_at: z.string().optional().nullable(),
    createdAt: z.string().optional().nullable(),
  })
  .passthrough();

export type TawnyAgent = z.infer<typeof AgentSchema>;
export type TawnyAlert = z.infer<typeof AlertSchema>;

export class TawnyClient {
  constructor(private readonly options: HttpClientOptions) {}

  async listAgents(): Promise<TawnyAgent[]> {
    const raw = await upstreamJson<unknown>(
      "tawny",
      "agents.list",
      this.options,
      "/api/agents",
    );
    if (Array.isArray(raw)) {
      return raw.map((row) => AgentSchema.parse(row));
    }
    if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)) {
      return ((raw as { items: unknown[] }).items).map((row) => AgentSchema.parse(row));
    }
    if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
      return ((raw as { data: unknown[] }).data).map((row) => AgentSchema.parse(row));
    }
    return [];
  }

  async listAlerts(limit = 50): Promise<TawnyAlert[]> {
    const raw = await upstreamJson<unknown>(
      "tawny",
      "alerts.list",
      this.options,
      `/api/alerts?limit=${encodeURIComponent(String(limit))}`,
    );
    if (Array.isArray(raw)) {
      return raw.map((row) => AlertSchema.parse(row));
    }
    if (raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)) {
      return ((raw as { items: unknown[] }).items).map((row) => AlertSchema.parse(row));
    }
    return [];
  }

  async getAgent(id: string): Promise<TawnyAgent | null> {
    try {
      const raw = await upstreamJson<unknown>(
        "tawny",
        "agents.get",
        this.options,
        `/api/agents/${encodeURIComponent(id)}`,
      );
      return AgentSchema.parse(raw);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        (error as { status: number | null }).status === 404
      ) {
        return null;
      }
      throw error;
    }
  }
}
