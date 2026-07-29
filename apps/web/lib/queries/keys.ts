export const queryKeys = {
  session: ["session", "me"] as const,
  commandSummary: ["command", "summary"] as const,
  approvals: ["approvals"] as const,
  agents: ["agents"] as const,
  agent: (id: string) => ["agents", id] as const,
  missions: ["missions"] as const,
  mission: (id: string) => ["missions", id] as const,
  missionRuns: (id: string) => ["missions", id, "runs"] as const,
  audit: (filters: Record<string, string | undefined>) =>
    ["audit", "events", filters] as const,
  connectors: ["connectors"] as const,
  controlPlane: ["control-plane", "status"] as const,
  tasks: ["tasks"] as const,
};
