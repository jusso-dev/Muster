import { z } from "zod";

export const ReadinessEvidenceStateSchema = z.enum([
  "reported",
  "unavailable",
  "unknown",
]);
export type ReadinessEvidenceState = z.infer<
  typeof ReadinessEvidenceStateSchema
>;

export const AgentPermissionModeSchema = z.enum([
  "read_only",
  "approval_gated",
  "unknown",
]);
export type AgentPermissionMode = z.infer<typeof AgentPermissionModeSchema>;

export const AgentLifecycleStateSchema = z.enum([
  "idle",
  "running",
  "stopped",
  "failed",
  "unknown",
]);
export type AgentLifecycleState = z.infer<typeof AgentLifecycleStateSchema>;

const boundedStrings = z.array(z.string().trim().min(1).max(160)).max(100);

export const AgentReadinessEvidenceSchema = z.object({
  processIdentity: z.string().trim().min(1).max(200),
  gatewayState: ReadinessEvidenceStateSchema,
  authenticationState: ReadinessEvidenceStateSchema,
  observerState: ReadinessEvidenceStateSchema,
  lifecycleEvidenceState: ReadinessEvidenceStateSchema,
  lifecycleState: AgentLifecycleStateSchema,
  capabilityState: ReadinessEvidenceStateSchema,
  toolState: ReadinessEvidenceStateSchema,
  permissionState: ReadinessEvidenceStateSchema,
  reportedRuntime: z.string().trim().min(1).max(80),
  reportedProvider: z.string().trim().min(1).max(80),
  reportedModel: z.string().trim().min(1).max(160),
  inputCapabilities: boundedStrings,
  outputCapabilities: boundedStrings,
  availableCommands: boundedStrings,
  toolSources: boundedStrings,
  toolRiskClasses: boundedStrings,
  requestedPermissionMode: AgentPermissionModeSchema,
  effectivePermissionMode: AgentPermissionModeSchema,
  limitations: z.array(z.string().trim().min(1).max(240)).max(20),
  heartbeatAt: z.coerce.date(),
  verifiedAt: z.coerce.date(),
});
export type AgentReadinessEvidence = z.infer<
  typeof AgentReadinessEvidenceSchema
>;

export type AgentReadinessDefinition = {
  status: string;
  killSwitch: boolean;
  requestedPermissionMode: AgentPermissionMode;
};

export type AgentReadinessSummary = {
  state: "ready" | "needs_attention" | "unknown";
  reason: string;
  freshness: "fresh" | "stale" | "unknown";
  verifiedAt: string | null;
  ageSeconds: number | null;
  process: { current: boolean | null };
  lifecycle: {
    evidence: ReadinessEvidenceState;
    state: AgentLifecycleState;
  };
  evidence: {
    gateway: ReadinessEvidenceState;
    authentication: ReadinessEvidenceState;
    observer: ReadinessEvidenceState;
    capabilities: ReadinessEvidenceState;
    tools: ReadinessEvidenceState;
    permissions: ReadinessEvidenceState;
  };
  permissions: {
    requested: AgentPermissionMode;
    effective: AgentPermissionMode;
    diverges: boolean | null;
  };
  reported: {
    runtime: string | null;
    provider: string | null;
    model: string | null;
    inputCapabilities: string[];
    outputCapabilities: string[];
    availableCommands: string[];
    toolSources: string[];
    toolRiskClasses: string[];
    limitations: string[];
  };
};

const unknownSummary = (
  definition: AgentReadinessDefinition,
  reason: string,
): AgentReadinessSummary => ({
  state: "unknown",
  reason,
  freshness: "unknown",
  verifiedAt: null,
  ageSeconds: null,
  process: { current: null },
  lifecycle: { evidence: "unknown", state: "unknown" },
  evidence: {
    gateway: "unknown",
    authentication: "unknown",
    observer: "unknown",
    capabilities: "unknown",
    tools: "unknown",
    permissions: "unknown",
  },
  permissions: {
    requested: definition.requestedPermissionMode,
    effective: "unknown",
    diverges: null,
  },
  reported: {
    runtime: null,
    provider: null,
    model: null,
    inputCapabilities: [],
    outputCapabilities: [],
    availableCommands: [],
    toolSources: [],
    toolRiskClasses: [],
    limitations: [],
  },
});

export function reduceAgentReadiness(
  definition: AgentReadinessDefinition,
  input: unknown,
  currentProcessIdentity: string | null,
  options: { now?: Date; freshnessMs?: number } = {},
): AgentReadinessSummary {
  const parsed = AgentReadinessEvidenceSchema.safeParse(input);
  if (!parsed.success) {
    return unknownSummary(
      definition,
      "Readiness evidence is missing or malformed.",
    );
  }
  const evidence = parsed.data;
  const now = options.now ?? new Date();
  const freshnessMs = options.freshnessMs ?? 120_000;
  const newestEvidenceAt = Math.min(
    evidence.verifiedAt.getTime(),
    evidence.heartbeatAt.getTime(),
  );
  const ageMs = Math.max(0, now.getTime() - newestEvidenceAt);
  const fresh = ageMs <= freshnessMs;
  const currentProcess =
    currentProcessIdentity === null
      ? null
      : evidence.processIdentity === currentProcessIdentity;
  const permissionUnknown =
    evidence.permissionState === "unknown"
    || evidence.requestedPermissionMode === "unknown"
    || evidence.effectivePermissionMode === "unknown";
  const permissionDiverges = permissionUnknown
    ? null
    : evidence.requestedPermissionMode !== evidence.effectivePermissionMode
      || definition.requestedPermissionMode
        !== evidence.effectivePermissionMode;
  const summary: AgentReadinessSummary = {
    state: "ready",
    reason: "Runtime verification is fresh and permissions match.",
    freshness: fresh ? "fresh" : "stale",
    verifiedAt: evidence.verifiedAt.toISOString(),
    ageSeconds: Math.floor(ageMs / 1_000),
    process: { current: currentProcess },
    lifecycle: {
      evidence: evidence.lifecycleEvidenceState,
      state: evidence.lifecycleState,
    },
    evidence: {
      gateway: evidence.gatewayState,
      authentication: evidence.authenticationState,
      observer: evidence.observerState,
      capabilities: evidence.capabilityState,
      tools: evidence.toolState,
      permissions: evidence.permissionState,
    },
    permissions: {
      requested: definition.requestedPermissionMode,
      effective: evidence.effectivePermissionMode,
      diverges: permissionDiverges,
    },
    reported: {
      runtime: evidence.reportedRuntime,
      provider: evidence.reportedProvider,
      model: evidence.reportedModel,
      inputCapabilities: evidence.inputCapabilities,
      outputCapabilities: evidence.outputCapabilities,
      availableCommands: evidence.availableCommands,
      toolSources: evidence.toolSources,
      toolRiskClasses: evidence.toolRiskClasses,
      limitations: evidence.limitations,
    },
  };

  if (definition.status !== "active") {
    return {
      ...summary,
      state: "needs_attention",
      reason: "Agent configuration is not active.",
    };
  }
  if (definition.killSwitch) {
    return {
      ...summary,
      state: "needs_attention",
      reason: "Agent kill switch is active.",
    };
  }
  if (currentProcess === null) {
    return {
      ...summary,
      state: "unknown",
      reason: "Current gateway process is unknown.",
    };
  }
  if (!currentProcess) {
    return {
      ...summary,
      state: "needs_attention",
      reason: "Verification belongs to a previous gateway process.",
    };
  }

  const unknownEvidence = Object.entries(summary.evidence).find(
    ([, state]) => state === "unknown",
  );
  if (unknownEvidence || evidence.lifecycleState === "unknown") {
    return {
      ...summary,
      state: "unknown",
      reason: "Required runtime evidence is unknown.",
    };
  }
  const unavailableEvidence = Object.entries(summary.evidence).find(
    ([, state]) => state === "unavailable",
  );
  if (unavailableEvidence) {
    return {
      ...summary,
      state: "needs_attention",
      reason: `${unavailableEvidence[0]} evidence is unavailable.`,
    };
  }
  if (
    evidence.lifecycleState === "stopped"
    || evidence.lifecycleState === "failed"
  ) {
    return {
      ...summary,
      state: "needs_attention",
      reason: `Runtime lifecycle is ${evidence.lifecycleState}.`,
    };
  }
  if (!fresh) {
    return {
      ...summary,
      state: "needs_attention",
      reason: "Runtime verification is stale.",
    };
  }
  if (permissionUnknown) {
    return {
      ...summary,
      state: "unknown",
      reason: "Effective permission mode is unknown.",
    };
  }
  if (permissionDiverges) {
    return {
      ...summary,
      state: "needs_attention",
      reason: "Requested and effective permission modes diverge.",
    };
  }
  return summary;
}
