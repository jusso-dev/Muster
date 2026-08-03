import type { OpsEnv } from "../env.ts";
import type { TawnyAgent, TawnyAlert, TawnyClient } from "../clients/tawny.ts";

export type HostHealth = "online" | "stale" | "offline" | "unknown";

export type FleetHost = {
  id: string;
  hostname: string;
  status: HostHealth;
  rawStatus: string | null;
  lastSeenAt: string | null;
  minutesSinceSeen: number | null;
  platform: string | null;
  version: string | null;
  openAlertCount: number;
  source: "tawny";
};

function lastSeen(agent: TawnyAgent): string | null {
  return (
    agent.last_seen_at ??
    agent.lastSeenAt ??
    agent.last_heartbeat_at ??
    null
  );
}

function hostnameOf(agent: TawnyAgent): string {
  return (agent.hostname || agent.name || agent.id || "unknown").toString();
}

function classify(
  agent: TawnyAgent,
  seenAt: string | null,
  staleMinutes: number,
  now: Date,
): HostHealth {
  const raw = (agent.status ?? "").toLowerCase();
  if (raw.includes("offline") || raw.includes("disconnected")) return "offline";
  if (!seenAt) return "unknown";
  const ts = Date.parse(seenAt);
  if (Number.isNaN(ts)) return "unknown";
  const mins = (now.getTime() - ts) / 60_000;
  if (mins > staleMinutes * 4) return "offline";
  if (mins > staleMinutes) return "stale";
  if (raw.includes("online") || raw.includes("healthy") || raw === "active" || raw === "") {
    return "online";
  }
  return "online";
}

function agentIdOfAlert(alert: TawnyAlert): string | null {
  return alert.agent_id ?? alert.agentId ?? null;
}

export async function getFleetSnapshot(
  tawny: TawnyClient,
  env: Pick<OpsEnv, "fleetStaleMinutes">,
  now = new Date(),
): Promise<{
  source: "tawny";
  generatedAt: string;
  totals: Record<HostHealth, number> & { hosts: number; openAlerts: number };
  hosts: FleetHost[];
}> {
  const [agents, alerts] = await Promise.all([
    tawny.listAgents(),
    tawny.listAlerts(100).catch(() => [] as TawnyAlert[]),
  ]);

  const alertCounts = new Map<string, number>();
  for (const alert of alerts) {
    const id = agentIdOfAlert(alert);
    if (!id) continue;
    alertCounts.set(id, (alertCounts.get(id) ?? 0) + 1);
  }

  const hosts: FleetHost[] = agents.map((agent) => {
    const seen = lastSeen(agent);
    const status = classify(agent, seen, env.fleetStaleMinutes, now);
    const minutesSinceSeen =
      seen && !Number.isNaN(Date.parse(seen))
        ? Math.round((now.getTime() - Date.parse(seen)) / 60_000)
        : null;
    return {
      id: agent.id,
      hostname: hostnameOf(agent),
      status,
      rawStatus: agent.status ?? null,
      lastSeenAt: seen,
      minutesSinceSeen,
      platform: agent.platform ?? null,
      version: agent.version ?? null,
      openAlertCount: alertCounts.get(agent.id) ?? 0,
      source: "tawny",
    };
  });

  hosts.sort((a, b) => {
    const rank = { offline: 0, stale: 1, unknown: 2, online: 3 } as const;
    return rank[a.status] - rank[b.status] || b.openAlertCount - a.openAlertCount;
  });

  const totals = {
    hosts: hosts.length,
    online: hosts.filter((h) => h.status === "online").length,
    stale: hosts.filter((h) => h.status === "stale").length,
    offline: hosts.filter((h) => h.status === "offline").length,
    unknown: hosts.filter((h) => h.status === "unknown").length,
    openAlerts: alerts.length,
  };

  return {
    source: "tawny",
    generatedAt: now.toISOString(),
    totals,
    hosts,
  };
}
