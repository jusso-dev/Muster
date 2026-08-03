import type { OpsEnv } from "../env.ts";
import { BrolgaClient } from "../clients/brolga.ts";
import { KelpieClient } from "../clients/kelpie.ts";
import { TawnyClient } from "../clients/tawny.ts";
import { getCaseQueue } from "./cases.ts";
import { getFleetSnapshot } from "./fleet.ts";

export type OpsClients = {
  tawny?: TawnyClient | null;
  kelpie?: KelpieClient | null;
  brolga?: BrolgaClient | null;
};

export async function buildBriefing(env: OpsEnv, clients: OpsClients) {
  const generatedAt = new Date().toISOString();
  const errors: string[] = [];

  const fleet = clients.tawny
    ? await getFleetSnapshot(clients.tawny, env).catch((error: unknown) => {
        errors.push(
          `tawny: ${error instanceof Error ? error.message : "fleet failed"}`,
        );
        return null;
      })
    : null;

  const cases = clients.kelpie
    ? await getCaseQueue(clients.kelpie, env).catch((error: unknown) => {
        errors.push(
          `kelpie: ${error instanceof Error ? error.message : "cases failed"}`,
        );
        return null;
      })
    : null;

  let brolga: {
    health?: { status: string; version?: string | undefined };
    stats?: Awaited<ReturnType<BrolgaClient["stats"]>>;
  } | null = null;
  if (clients.brolga) {
    try {
      const [health, stats] = await Promise.all([
        clients.brolga.health(),
        clients.brolga.stats(),
      ]);
      brolga = {
        health: {
          status: health.status,
          ...(health.version !== undefined ? { version: health.version } : {}),
        },
        stats,
      };
    } catch (error) {
      errors.push(
        `brolga: ${error instanceof Error ? error.message : "stats failed"}`,
      );
    }
  }

  const headlines: string[] = [];
  if (fleet) {
    if (fleet.totals.offline > 0) {
      headlines.push(`${fleet.totals.offline} Tawny host(s) offline`);
    }
    if (fleet.totals.stale > 0) {
      headlines.push(`${fleet.totals.stale} Tawny host(s) stale`);
    }
    if (fleet.totals.openAlerts > 0) {
      headlines.push(`${fleet.totals.openAlerts} recent Tawny alert(s) in sample`);
    }
  } else if (!env.tawnyBaseUrl) {
    headlines.push("Tawny not configured");
  }

  if (cases) {
    if (cases.agingCount > 0) {
      headlines.push(`${cases.agingCount} open Kelpie case(s) aging`);
    }
    if (cases.unassignedCount > 0) {
      headlines.push(`${cases.unassignedCount} open case(s) unassigned`);
    }
    headlines.push(cases.mttrHint);
  } else if (!env.kelpieBaseUrl) {
    headlines.push("Kelpie not configured");
  }

  if (brolga?.stats) {
    headlines.push(
      `Brolga store: ${brolga.stats.entities} entities, ${brolga.stats.claims ?? 0} claims`,
    );
  } else if (!env.brolgaBaseUrl) {
    headlines.push("Brolga not configured");
  }

  if (headlines.length === 0) {
    headlines.push("No urgent signals in configured sources");
  }

  return {
    product: "muster-ops",
    generatedAt,
    headlines,
    fleet: fleet
      ? {
          totals: fleet.totals,
          worst: fleet.hosts.filter((h) => h.status !== "online").slice(0, 10),
        }
      : null,
    cases: cases
      ? {
          openCount: cases.openCount,
          agingCount: cases.agingCount,
          unassignedCount: cases.unassignedCount,
          needsAttention: cases.cases.filter((c) => c.needsAttention).slice(0, 10),
          mttrHint: cases.mttrHint,
        }
      : null,
    brolga,
    errors,
  };
}

export function createClientsFromEnv(env: OpsEnv): OpsClients {
  return {
    tawny: env.tawnyBaseUrl
      ? new TawnyClient({
          baseUrl: env.tawnyBaseUrl,
          token: env.tawnyToken,
        })
      : null,
    kelpie: env.kelpieBaseUrl
      ? new KelpieClient({
          baseUrl: env.kelpieBaseUrl,
          token: env.kelpieToken,
        })
      : null,
    brolga: env.brolgaBaseUrl
      ? new BrolgaClient({
          baseUrl: env.brolgaBaseUrl,
          token: env.brolgaToken,
        })
      : null,
  };
}
