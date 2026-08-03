import { z } from "zod";
import { type HttpClientOptions, upstreamJson } from "../http.ts";

const HealthSchema = z.object({
  status: z.string(),
  version: z.string().optional(),
});

const StatsSchema = z
  .object({
    schema_version: z.number().optional(),
    entities: z.number(),
    relationships: z.number().optional(),
    claims: z.number().optional(),
    sightings: z.number().optional(),
    sources: z.number().optional(),
    quarantined: z.number().optional(),
  })
  .passthrough();

const ContextPackSchema = z
  .object({
    schema_version: z.string(),
    disposition: z.string().optional().nullable(),
    confidence: z.number().optional().nullable(),
    subject: z
      .object({
        kind: z.string().optional(),
        value: z.string().optional(),
      })
      .passthrough()
      .optional(),
    fingerprint: z.string().optional().nullable(),
  })
  .passthrough();

export type BrolgaStats = z.infer<typeof StatsSchema>;
export type BrolgaContextPack = z.infer<typeof ContextPackSchema>;

export class BrolgaClient {
  constructor(private readonly options: HttpClientOptions) {}

  async health(): Promise<z.infer<typeof HealthSchema>> {
    const raw = await upstreamJson<unknown>(
      "brolga",
      "health",
      this.options,
      "/api/v1/health",
    );
    return HealthSchema.parse(raw);
  }

  async stats(): Promise<BrolgaStats> {
    const raw = await upstreamJson<unknown>(
      "brolga",
      "stats",
      this.options,
      "/api/v1/stats",
    );
    if (raw && typeof raw === "object" && "data" in raw) {
      return StatsSchema.parse((raw as { data: unknown }).data);
    }
    return StatsSchema.parse(raw);
  }

  async context(input: {
    kind: string;
    value: string;
    purpose?: string;
    detailLevel?: string;
  }): Promise<BrolgaContextPack> {
    const raw = await upstreamJson<unknown>(
      "brolga",
      "context",
      this.options,
      "/api/v1/context",
      {
        method: "POST",
        body: JSON.stringify({
          subject: { kind: input.kind, value: input.value },
          purpose: input.purpose ?? "case_enrichment",
          detail_level: input.detailLevel ?? "L1",
        }),
      },
    );
    return ContextPackSchema.parse(raw);
  }
}
