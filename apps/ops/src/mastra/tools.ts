import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  BrolgaClient,
  buildBriefing,
  createClientsFromEnv,
  getCaseQueue,
  getFleetSnapshot,
  loadOpsEnv,
} from "@muster/ops";

function clients() {
  const env = loadOpsEnv();
  return { env, ...createClientsFromEnv(env) };
}

export const fleetListTool = createTool({
  id: "fleet_list",
  description:
    "List Tawny endpoint fleet health: online, stale, offline hosts and open alert counts. Use when asked which hosts are healthy or missing.",
  inputSchema: z.object({
    status: z
      .enum(["online", "stale", "offline", "unknown", "all"])
      .optional()
      .describe("Filter by health status; default all"),
  }),
  execute: async ({ status }) => {
    const { env, tawny } = clients();
    if (!tawny) {
      return { error: "TAWNY_BASE_URL is not configured", hosts: [] };
    }
    const snapshot = await getFleetSnapshot(tawny, env);
    const hosts =
      !status || status === "all"
        ? snapshot.hosts
        : snapshot.hosts.filter((h) => h.status === status);
    return {
      source: snapshot.source,
      generatedAt: snapshot.generatedAt,
      totals: snapshot.totals,
      hosts: hosts.slice(0, 50),
    };
  },
});

export const fleetHostTool = createTool({
  id: "fleet_host",
  description:
    "Get one Tawny host by agent id or hostname substring, including alert count and last seen.",
  inputSchema: z.object({
    query: z.string().describe("Agent id or hostname fragment"),
  }),
  execute: async ({ query }) => {
    const { env, tawny } = clients();
    if (!tawny) return { error: "TAWNY_BASE_URL is not configured" };
    const snapshot = await getFleetSnapshot(tawny, env);
    const q = query.toLowerCase();
    const host = snapshot.hosts.find(
      (h) => h.id === query || h.hostname.toLowerCase().includes(q),
    );
    if (!host) return { found: false, query };
    return { found: true, host };
  },
});

export const casesOpenTool = createTool({
  id: "cases_open",
  description:
    "List open Kelpie cases with age, assignee gaps, and needs-attention reasons (MTTR debt).",
  inputSchema: z.object({
    needsAttentionOnly: z
      .boolean()
      .optional()
      .describe("If true, only cases with aging/unassigned/SLA issues"),
  }),
  execute: async ({ needsAttentionOnly }) => {
    const { env, kelpie } = clients();
    if (!kelpie) return { error: "KELPIE_BASE_URL is not configured" };
    const queue = await getCaseQueue(kelpie, env);
    const cases = needsAttentionOnly
      ? queue.cases.filter((c) => c.needsAttention)
      : queue.cases;
    return {
      source: queue.source,
      generatedAt: queue.generatedAt,
      openCount: queue.openCount,
      agingCount: queue.agingCount,
      unassignedCount: queue.unassignedCount,
      mttrHint: queue.mttrHint,
      cases: cases.slice(0, 40),
    };
  },
});

export const tiLookupTool = createTool({
  id: "ti_lookup",
  description:
    "Look up threat intelligence context for an IP, domain, hostname, URL, or file hash via Brolga.",
  inputSchema: z.object({
    kind: z
      .enum(["ip", "ipv4", "ipv6", "domain", "hostname", "url", "file_hash", "email"])
      .describe("Observable kind for Brolga"),
    value: z.string().describe("Observable value"),
  }),
  execute: async ({ kind, value }) => {
    const { brolga } = clients();
    if (!brolga) return { error: "BROLGA_BASE_URL is not configured" };
    const pack = await brolga.context({ kind, value: value.trim() });
    return {
      source: "brolga",
      disposition: pack.disposition ?? null,
      confidence: pack.confidence ?? null,
      subject: pack.subject ?? { kind, value },
      fingerprint: pack.fingerprint ?? null,
      schema_version: pack.schema_version,
      pack,
    };
  },
});

export const brolgaStatsTool = createTool({
  id: "brolga_stats",
  description: "Brolga store health and TI volume counts (entities, claims, sources).",
  inputSchema: z.object({}),
  execute: async () => {
    const { brolga } = clients();
    if (!brolga) return { error: "BROLGA_BASE_URL is not configured" };
    const [health, stats] = await Promise.all([brolga.health(), brolga.stats()]);
    return { source: "brolga", health, stats };
  },
});

export const briefingTool = createTool({
  id: "ops_briefing",
  description:
    "Single briefing: worst fleet hosts, Kelpie cases needing attention, Brolga TI volume, headlines for Slack.",
  inputSchema: z.object({}),
  execute: async () => {
    const env = loadOpsEnv();
    return buildBriefing(env, createClientsFromEnv(env));
  },
});

export const opsTools = {
  fleetListTool,
  fleetHostTool,
  casesOpenTool,
  tiLookupTool,
  brolgaStatsTool,
  briefingTool,
};

export type { BrolgaClient };
