/**
 * @muster/ops — fleet, IR queue, and TI lookups against live Tawny / Kelpie / Brolga.
 * No chat. Mastra tools and HTTP live in apps/ops.
 */

export { loadOpsEnv, assertConfigured, type OpsEnv } from "./env.ts";
export { UpstreamError } from "./http.ts";
export { TawnyClient, type TawnyAgent, type TawnyAlert } from "./clients/tawny.ts";
export { KelpieClient, type KelpieCase } from "./clients/kelpie.ts";
export {
  BrolgaClient,
  type BrolgaStats,
  type BrolgaContextPack,
} from "./clients/brolga.ts";
export {
  getFleetSnapshot,
  type FleetHost,
  type HostHealth,
} from "./services/fleet.ts";
export { getCaseQueue, type CaseAttention } from "./services/cases.ts";
export {
  buildBriefing,
  createClientsFromEnv,
  type OpsClients,
} from "./services/briefing.ts";
