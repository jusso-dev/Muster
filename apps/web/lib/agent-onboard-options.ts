/**
 * Operator-facing choices for agent onboard forms.
 * Values must stay compatible with agent-onboard-domain and authz capability ids.
 */

export type SelectOption = {
  value: string;
  label: string;
  description: string;
};

/** Model is a budget/display label; runtime still uses the Codex gateway. */
export const AGENT_MODEL_OPTIONS: readonly SelectOption[] = [
  {
    value: "configured",
    label: "Server default",
    description:
      "Uses MUSTER_CODEX_MODEL from the host environment. Recommended for homelab.",
  },
  {
    value: "o4-mini",
    label: "o4-mini (fast)",
    description: "Faster, cheaper Codex model for routine triage and briefs.",
  },
  {
    value: "o3",
    label: "o3 (deep)",
    description: "Stronger reasoning for hunts, research, and multi-step analysis.",
  },
  {
    value: "gpt-5",
    label: "gpt-5 (general)",
    description: "General-purpose Codex model when configured on the gateway.",
  },
] as const;

export type CapabilityOption = SelectOption & {
  group: string;
  recommended?: boolean;
};

export const AGENT_CAPABILITY_OPTIONS: readonly CapabilityOption[] = [
  {
    group: "Pack coordination",
    value: "agents.read",
    label: "See agents",
    description: "List agents and readiness.",
    recommended: true,
  },
  {
    group: "Pack coordination",
    value: "agents.invoke",
    label: "Invoke agents",
    description: "Start agent runs (also needed for handoff targets).",
  },
  {
    group: "Pack coordination",
    value: "agents.handoff",
    label: "Hand off work",
    description: "Request pack handoff to another agent.",
    recommended: true,
  },
  {
    group: "Pack coordination",
    value: "agents.cancel",
    label: "Cancel agent runs",
    description: "Stop in-flight agent work.",
  },
  {
    group: "Alerts & investigations",
    value: "alerts.read",
    label: "Read alerts",
    description: "See organisation alerts and severity.",
    recommended: true,
  },
  {
    group: "Alerts & investigations",
    value: "investigations.read",
    label: "Read investigations",
    description: "Open investigation records in Muster.",
    recommended: true,
  },
  {
    group: "Alerts & investigations",
    value: "investigations.update",
    label: "Update investigations",
    description: "Change investigation status and notes.",
  },
  {
    group: "Kelpie (cases)",
    value: "kelpie.cases.read",
    label: "Read Kelpie cases",
    description: "Search/get formal cases via the governed connector / MCP.",
    recommended: true,
  },
  {
    group: "Kelpie (cases)",
    value: "kelpie.cases.create",
    label: "Create Kelpie cases",
    description: "Propose/create cases (writes stay approval-gated where required).",
  },
  {
    group: "Kelpie (cases)",
    value: "kelpie.cases.update",
    label: "Update Kelpie cases",
    description: "Update case status, summary, timeline comments.",
  },
  {
    group: "Tawny (endpoints)",
    value: "tawny.telemetry.read",
    label: "Read Tawny telemetry",
    description: "Endpoint inventory and alert lists from Tawny.",
  },
  {
    group: "Tawny (endpoints)",
    value: "tawny.hunts.execute",
    label: "Run Tawny hunts",
    description: "Bounded hunts (Jessie-style). Results are untrusted evidence.",
  },
  {
    group: "Tawny (endpoints)",
    value: "tawny.response.isolate_host",
    label: "Isolate host (dangerous)",
    description: "Request host isolation — always approval-gated in production.",
  },
  {
    group: "Brolga (threat intel)",
    value: "brolga.context.read",
    label: "Read Brolga TI packs",
    description:
      "Normalised context packs for observables. Disposition unknown ≠ benign.",
  },
  {
    group: "Network / UniFi",
    value: "unifi.network.read",
    label: "Read UniFi network",
    description: "Sites, clients, devices when UniFi connector is healthy.",
  },
  {
    group: "Research",
    value: "research.feeds.read",
    label: "Read research feeds",
    description: "Allowlisted HTTPS feeds for Alfie-style research.",
  },
  {
    group: "Sentinel",
    value: "sentinel.query.execute",
    label: "Run Sentinel queries",
    description: "Bounded Log Analytics queries when Sentinel is configured.",
  },
  {
    group: "Sentinel",
    value: "sentinel.rules.read",
    label: "Read Sentinel rules",
    description: "Analytics rule inventory (read-only).",
  },
  {
    group: "Evidence & audit",
    value: "evidence.read",
    label: "Read evidence",
    description: "Open evidence metadata attached to work.",
  },
  {
    group: "Evidence & audit",
    value: "audit.read",
    label: "Read audit",
    description: "View organisation audit events (Parker-style briefs).",
  },
] as const;

export const DEFAULT_AGENT_CAPABILITIES = [
  "agents.read",
  "agents.handoff",
  "alerts.read",
  "investigations.read",
] as const;

export function capabilityGroups(): {
  group: string;
  options: CapabilityOption[];
}[] {
  const map = new Map<string, CapabilityOption[]>();
  for (const option of AGENT_CAPABILITY_OPTIONS) {
    const list = map.get(option.group) ?? [];
    list.push(option);
    map.set(option.group, list);
  }
  return [...map.entries()].map(([group, options]) => ({ group, options }));
}

export function modelOption(value: string): SelectOption | undefined {
  return AGENT_MODEL_OPTIONS.find((option) => option.value === value);
}

/** Human invite roles — labels for operators, values match authz starter roles. */
export const HUMAN_ROLE_OPTIONS: readonly SelectOption[] = [
  {
    value: "analyst",
    label: "Analyst",
    description: "Day-to-day triage: alerts, investigations, limited hunts.",
  },
  {
    value: "senior_analyst",
    label: "Senior analyst",
    description: "Broader investigation updates and case create.",
  },
  {
    value: "threat_hunter",
    label: "Threat hunter",
    description: "Tawny hunts, UniFi, Sentinel query — Jessie-adjacent.",
  },
  {
    value: "detection_engineer",
    label: "Detection engineer",
    description: "Sentinel rules and detection content.",
  },
  {
    value: "incident_commander",
    label: "Incident commander",
    description: "Promote investigations, isolate host (gated), lead response.",
  },
  {
    value: "security_manager",
    label: "Security manager",
    description: "Wide operational rights without full administration.",
  },
  {
    value: "administrator",
    label: "Administrator",
    description: "Full org control including invites, connectors, agents.",
  },
  {
    value: "read_only",
    label: "Read only",
    description: "View surfaces without mutations.",
  },
  {
    value: "auditor",
    label: "Auditor",
    description: "Audit and evidence export focus.",
  },
] as const;
