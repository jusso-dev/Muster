import type { Capability } from "@muster/authz";

/**
 * Pack handoff v1 — agent-to-agent delegation inside the dog pack.
 *
 * The graph is an explicit allow-list, not a mesh. Every edge is a deliberate
 * operational route we are willing to audit; anything not listed is refused.
 * Parker is the ops lead, so it is the only bidirectional hub. Jessie may push
 * a technical thread to Alfie for research, but Alfie never hands back to
 * Jessie directly — research returns through Parker so the ops lead keeps the
 * operational picture.
 */
export const PACK_HANDOFF_AGENTS = ["Parker", "Jessie", "Alfie"] as const;
export type PackHandoffAgent = (typeof PACK_HANDOFF_AGENTS)[number];

export const PACK_HANDOFF_REASONS = [
  "triage",
  "hunt",
  "research",
  "reporting",
  "response",
] as const;
export type PackHandoffReason = (typeof PACK_HANDOFF_REASONS)[number];

export type PackHandoffEdge = {
  from: PackHandoffAgent;
  to: PackHandoffAgent;
  reasons: readonly PackHandoffReason[];
};

export const PACK_HANDOFF_EDGES: readonly PackHandoffEdge[] = [
  { from: "Parker", to: "Jessie", reasons: ["hunt", "triage", "response"] },
  { from: "Jessie", to: "Parker", reasons: ["triage", "reporting", "response"] },
  { from: "Parker", to: "Alfie", reasons: ["research", "reporting"] },
  { from: "Alfie", to: "Parker", reasons: ["reporting", "triage"] },
  // One-way: a hunt thread may need vendor/CVE research. The answer comes back
  // through Parker, not straight to Jessie, so nothing loops unsupervised.
  { from: "Jessie", to: "Alfie", reasons: ["research"] },
];

/**
 * Capabilities that make a handoff high risk regardless of the edge: the
 * target agent would be able to change or act on production state. These
 * always require a human approval before the target run is queued.
 */
export const PACK_HANDOFF_HIGH_RISK_CAPABILITIES = [
  "tawny.response.kill_process",
  "tawny.response.isolate_host",
  "sentinel.rules.publish",
  "bower.policy.publish",
  "kelpie.cases.update",
  "investigations.close",
  "administration.manage",
] as const satisfies readonly Capability[];

/** Approval action key registered in @muster/authz actionApprovalPolicy. */
export const PACK_HANDOFF_APPROVAL_ACTION = "pack.handoff.high-risk";

/** Capability required to request any handoff at all. */
export const PACK_HANDOFF_CAPABILITY = "agents.handoff" satisfies Capability;

export type PackHandoffDecision =
  | {
      allowed: true;
      requiresApproval: boolean;
      highRiskCapabilities: readonly string[];
    }
  | { allowed: false; code: PackHandoffDenialCode; detail: string };

export type PackHandoffDenialCode =
  | "unknown_agent"
  | "self_handoff"
  | "edge_not_allowed"
  | "reason_not_allowed"
  | "unknown_capability";

export function isPackHandoffAgent(value: string): value is PackHandoffAgent {
  return (PACK_HANDOFF_AGENTS as readonly string[]).includes(value);
}

export function packHandoffTargets(from: string): PackHandoffAgent[] {
  return PACK_HANDOFF_EDGES.filter((edge) => edge.from === from).map(
    (edge) => edge.to,
  );
}

/**
 * Single policy gate for a requested handoff. Pure so both the API route and
 * the worker can evaluate the same rules without a database round trip.
 */
export function evaluatePackHandoff(input: {
  from: string;
  to: string;
  reason: string;
  requestedCapabilities: readonly string[];
  knownCapabilities: readonly string[];
}): PackHandoffDecision {
  if (!isPackHandoffAgent(input.from) || !isPackHandoffAgent(input.to)) {
    return {
      allowed: false,
      code: "unknown_agent",
      detail: `Handoff is limited to the governed pack: ${PACK_HANDOFF_AGENTS.join(", ")}.`,
    };
  }
  if (input.from === input.to) {
    return {
      allowed: false,
      code: "self_handoff",
      detail: "An agent cannot hand off to itself.",
    };
  }
  const edge = PACK_HANDOFF_EDGES.find(
    (candidate) => candidate.from === input.from && candidate.to === input.to,
  );
  if (!edge) {
    return {
      allowed: false,
      code: "edge_not_allowed",
      detail: `${input.from} may hand off to ${packHandoffTargets(input.from).join(", ") || "nobody"} only.`,
    };
  }
  if (
    !(edge.reasons as readonly string[]).includes(input.reason)
  ) {
    return {
      allowed: false,
      code: "reason_not_allowed",
      detail: `${input.from} to ${input.to} supports: ${edge.reasons.join(", ")}.`,
    };
  }

  const known = new Set(input.knownCapabilities);
  const unknown = input.requestedCapabilities.filter(
    (capability) => !known.has(capability),
  );
  if (unknown.length > 0) {
    return {
      allowed: false,
      code: "unknown_capability",
      detail: `Unknown capability requested: ${unknown.slice(0, 5).join(", ")}.`,
    };
  }

  const highRisk = input.requestedCapabilities.filter((capability) =>
    (PACK_HANDOFF_HIGH_RISK_CAPABILITIES as readonly string[]).includes(
      capability,
    ),
  );
  return {
    allowed: true,
    // A response-reason handoff is an action route even before any capability
    // is named, so it is gated the same way as an explicit high-risk grant.
    requiresApproval: highRisk.length > 0 || input.reason === "response",
    highRiskCapabilities: highRisk,
  };
}
