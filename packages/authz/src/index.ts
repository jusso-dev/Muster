export const capabilities = [
  "rooms.read",
  "rooms.create",
  "rooms.manage",
  "messages.create",
  "messages.moderate",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "tasks.assign",
  "alerts.read",
  "alerts.acknowledge",
  "alerts.dismiss",
  "alerts.promote",
  "investigations.read",
  "investigations.create",
  "investigations.update",
  "investigations.promote",
  "investigations.close",
  "kelpie.cases.read",
  "kelpie.cases.create",
  "kelpie.cases.update",
  "tawny.telemetry.read",
  "tawny.hunts.execute",
  "tawny.response.kill_process",
  "tawny.response.isolate_host",
  "bower.fleet.read",
  "bower.policy.read",
  "bower.policy.propose",
  "bower.policy.publish",
  "sentinel.query.execute",
  "sentinel.rules.read",
  "sentinel.rules.publish",
  "agents.read",
  "agents.invoke",
  "agents.manage",
  "agents.cancel",
  "workflows.read",
  "workflows.execute",
  "workflows.approve",
  "workflows.manage",
  "evidence.read",
  "evidence.upload",
  "evidence.export",
  "audit.read",
  "audit.export",
  "administration.manage",
] as const;

export type Capability = (typeof capabilities)[number];
export type StarterRole =
  | "administrator"
  | "security_manager"
  | "incident_commander"
  | "senior_analyst"
  | "analyst"
  | "detection_engineer"
  | "threat_hunter"
  | "read_only"
  | "auditor";

const readCapabilities: Capability[] = [
  "rooms.read",
  "tasks.read",
  "alerts.read",
  "investigations.read",
  "kelpie.cases.read",
  "agents.read",
  "workflows.read",
  "evidence.read",
];

export const starterRoleCapabilities: Record<StarterRole, readonly Capability[]> = {
  administrator: capabilities,
  security_manager: capabilities.filter(
    (capability) =>
      !capability.startsWith("administration.") &&
      capability !== "tawny.response.kill_process",
  ),
  incident_commander: [
    ...readCapabilities,
    "messages.create",
    "tasks.create",
    "tasks.update",
    "tasks.assign",
    "alerts.acknowledge",
    "alerts.promote",
    "investigations.create",
    "investigations.update",
    "investigations.promote",
    "investigations.close",
    "kelpie.cases.create",
    "kelpie.cases.update",
    "tawny.telemetry.read",
    "tawny.hunts.execute",
    "tawny.response.isolate_host",
    "agents.invoke",
    "agents.cancel",
    "workflows.execute",
    "workflows.approve",
    "evidence.upload",
  ],
  senior_analyst: [
    ...readCapabilities,
    "messages.create",
    "tasks.create",
    "tasks.update",
    "tasks.assign",
    "alerts.acknowledge",
    "alerts.dismiss",
    "alerts.promote",
    "investigations.create",
    "investigations.update",
    "investigations.promote",
    "investigations.close",
    "kelpie.cases.create",
    "tawny.telemetry.read",
    "tawny.hunts.execute",
    "agents.invoke",
    "agents.cancel",
    "workflows.execute",
    "workflows.approve",
    "evidence.upload",
  ],
  analyst: [
    ...readCapabilities,
    "messages.create",
    "tasks.create",
    "tasks.update",
    "tasks.assign",
    "alerts.acknowledge",
    "alerts.dismiss",
    "investigations.create",
    "investigations.update",
    "tawny.telemetry.read",
    "tawny.hunts.execute",
    "agents.invoke",
    "workflows.execute",
    "evidence.upload",
  ],
  detection_engineer: [
    ...readCapabilities,
    "messages.create",
    "tasks.create",
    "tasks.update",
    "tasks.assign",
    "investigations.create",
    "investigations.update",
    "sentinel.query.execute",
    "sentinel.rules.read",
    "sentinel.rules.publish",
    "agents.invoke",
    "workflows.execute",
    "evidence.upload",
  ],
  threat_hunter: [
    ...readCapabilities,
    "messages.create",
    "tasks.create",
    "tasks.update",
    "tasks.assign",
    "investigations.create",
    "investigations.update",
    "tawny.telemetry.read",
    "tawny.hunts.execute",
    "sentinel.query.execute",
    "agents.invoke",
    "workflows.execute",
  ],
  read_only: readCapabilities,
  auditor: [...readCapabilities, "audit.read", "audit.export", "evidence.export"],
};

export interface AuthorisationSubject {
  actorId: string;
  organisationId: string;
  capabilities: ReadonlySet<Capability>;
}

export class ForbiddenError extends Error {
  override readonly name = "ForbiddenError";
  constructor(readonly capability: Capability) {
    super(`Missing capability: ${capability}`);
  }
}

export function hasCapability(
  subject: AuthorisationSubject,
  capability: Capability,
): boolean {
  return subject.capabilities.has(capability);
}

export function requireCapability(
  subject: AuthorisationSubject,
  capability: Capability,
): void {
  if (!hasCapability(subject, capability)) throw new ForbiddenError(capability);
}

export const actionApprovalPolicy = {
  "investigation.promote": { approvalCount: 1, capability: "investigations.promote" },
  "endpoint.kill_process": {
    approvalCount: 1,
    capability: "tawny.response.kill_process",
  },
  "endpoint.isolate": {
    approvalCount: 1,
    capability: "tawny.response.isolate_host",
  },
  "identity.disable": { approvalCount: 1, capability: "administration.manage" },
  "network.block": { approvalCount: 1, capability: "workflows.approve" },
  "bower.policy.publish": {
    approvalCount: 1,
    capability: "bower.policy.publish",
  },
  "detection.publish": {
    approvalCount: 2,
    capability: "sentinel.rules.publish",
  },
  "critical-incident.close": {
    approvalCount: 1,
    capability: "investigations.close",
  },
  "evidence.export-sensitive": {
    approvalCount: 1,
    capability: "evidence.export",
  },
  "evidence.delete": { prohibited: true },
} as const satisfies Record<
  string,
  { approvalCount?: number; capability?: Capability; prohibited?: boolean }
>;

export type ApprovalAction = keyof typeof actionApprovalPolicy;

export function assertExecutableApproval(
  action: ApprovalAction,
  approvals: ReadonlyArray<{ actorId: string; status: "approved" | "rejected" }>,
): void {
  const policy = actionApprovalPolicy[action];
  if ("prohibited" in policy && policy.prohibited) {
    throw new ForbiddenError("evidence.export");
  }
  const distinctApprovers = new Set(
    approvals.filter((approval) => approval.status === "approved").map((approval) => approval.actorId),
  );
  const requiredCount = "approvalCount" in policy ? policy.approvalCount : 0;
  if (distinctApprovers.size < requiredCount) {
    throw new Error(`Approval requirement not met for ${action}`);
  }
}
