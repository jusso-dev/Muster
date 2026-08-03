import { z } from "zod";
import { type HttpClientOptions, upstreamJson } from "../http.ts";

const CaseSchema = z
  .object({
    id: z.string(),
    caseNumber: z.string().optional().nullable(),
    case_number: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    summary: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
    severity: z.string().optional().nullable(),
    openedAt: z.string().optional().nullable(),
    opened_at: z.string().optional().nullable(),
    closedAt: z.string().optional().nullable(),
    closed_at: z.string().optional().nullable(),
    acknowledgedAt: z.string().optional().nullable(),
    acknowledged_at: z.string().optional().nullable(),
    assigneeId: z.string().optional().nullable(),
    assignee_id: z.string().optional().nullable(),
    slaState: z.string().optional().nullable(),
    sla_state: z.string().optional().nullable(),
  })
  .passthrough();

export type KelpieCase = z.infer<typeof CaseSchema>;

export class KelpieClient {
  constructor(private readonly options: HttpClientOptions) {}

  async listCases(params?: {
    status?: string;
    limit?: number;
  }): Promise<KelpieCase[]> {
    const search = new URLSearchParams();
    if (params?.status) search.set("status", params.status);
    if (params?.limit) search.set("limit", String(params.limit));
    const qs = search.toString();
    const raw = await upstreamJson<unknown>(
      "kelpie",
      "cases.list",
      this.options,
      `/api/v1/cases${qs ? `?${qs}` : ""}`,
    );
    const rows = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
        ? (raw as { data: unknown[] }).data
        : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
          ? (raw as { items: unknown[] }).items
          : [];
    return rows.map((row) => CaseSchema.parse(row));
  }

  async getCase(id: string): Promise<KelpieCase> {
    const raw = await upstreamJson<unknown>(
      "kelpie",
      "cases.get",
      this.options,
      `/api/v1/cases/${encodeURIComponent(id)}`,
    );
    return CaseSchema.parse(raw);
  }
}
