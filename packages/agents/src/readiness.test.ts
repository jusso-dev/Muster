import { describe, expect, it } from "vitest";
import {
  reduceAgentReadiness,
  type AgentReadinessDefinition,
  type AgentReadinessEvidence,
} from "./readiness.ts";

const now = new Date("2026-07-26T20:00:00.000Z");
const definition: AgentReadinessDefinition = {
  status: "active",
  killSwitch: false,
  requestedPermissionMode: "read_only",
};
const reported: AgentReadinessEvidence = {
  processIdentity: "synthetic-process-current",
  gatewayState: "reported",
  authenticationState: "reported",
  observerState: "reported",
  lifecycleEvidenceState: "reported",
  lifecycleState: "idle",
  capabilityState: "reported",
  toolState: "reported",
  permissionState: "reported",
  reportedRuntime: "codex-subscription",
  reportedProvider: "openai",
  reportedModel: "configured",
  inputCapabilities: ["task", "investigation"],
  outputCapabilities: ["schema-valid security result"],
  availableCommands: ["run", "cancel"],
  toolSources: ["tawny", "kelpie"],
  toolRiskClasses: ["read", "approval_required"],
  requestedPermissionMode: "read_only",
  effectivePermissionMode: "read_only",
  limitations: ["Network access disabled"],
  heartbeatAt: new Date("2026-07-26T19:59:45.000Z"),
  verifiedAt: new Date("2026-07-26T19:59:50.000Z"),
};

describe("reduceAgentReadiness", () => {
  it("returns ready only for fresh current-process reported evidence", () => {
    expect(
      reduceAgentReadiness(definition, reported, reported.processIdentity, {
        now,
      }),
    ).toMatchObject({
      state: "ready",
      freshness: "fresh",
      process: { current: true },
      permissions: {
        requested: "read_only",
        effective: "read_only",
        diverges: false,
      },
    });
  });

  it("rejects stale and previous-process evidence", () => {
    expect(
      reduceAgentReadiness(definition, {
        ...reported,
        heartbeatAt: new Date("2026-07-26T19:50:00.000Z"),
      }, reported.processIdentity, { now }),
    ).toMatchObject({
      state: "needs_attention",
      freshness: "stale",
      reason: "Runtime verification is stale.",
    });
    expect(
      reduceAgentReadiness(
        definition,
        reported,
        "synthetic-process-restarted",
        { now },
      ),
    ).toMatchObject({
      state: "needs_attention",
      process: { current: false },
      reason: "Verification belongs to a previous gateway process.",
    });
  });

  it("makes requested and effective permission divergence visible", () => {
    expect(
      reduceAgentReadiness(
        definition,
        { ...reported, effectivePermissionMode: "approval_gated" },
        reported.processIdentity,
        { now },
      ),
    ).toMatchObject({
      state: "needs_attention",
      permissions: {
        requested: "read_only",
        effective: "approval_gated",
        diverges: true,
      },
    });
  });

  it("keeps unknown and unavailable evidence distinct", () => {
    expect(
      reduceAgentReadiness(
        definition,
        { ...reported, observerState: "unknown" },
        reported.processIdentity,
        { now },
      ),
    ).toMatchObject({
      state: "unknown",
      evidence: { observer: "unknown" },
    });
    expect(
      reduceAgentReadiness(
        definition,
        { ...reported, authenticationState: "unavailable" },
        reported.processIdentity,
        { now },
      ),
    ).toMatchObject({
      state: "needs_attention",
      evidence: { authentication: "unavailable" },
    });
  });

  it("returns unknown for missing or malformed evidence", () => {
    expect(
      reduceAgentReadiness(definition, null, null, { now }),
    ).toMatchObject({
      state: "unknown",
      freshness: "unknown",
    });
    expect(
      reduceAgentReadiness(
        definition,
        { ...reported, verifiedAt: "not-a-date" },
        reported.processIdentity,
        { now },
      ),
    ).toMatchObject({ state: "unknown" });
  });

  it("drops sensitive extras at the allowlist boundary", () => {
    const canary = "synthetic-readiness-secret-27";
    const result = reduceAgentReadiness(
      definition,
      {
        ...reported,
        apiKey: canary,
        environment: { DATABASE_PASSWORD: canary },
        executablePath: `/synthetic/${canary}`,
        rawConfiguration: canary,
      },
      reported.processIdentity,
      { now },
    );

    expect(JSON.stringify(result)).not.toContain(canary);
    expect(result.reported.inputCapabilities).toContain("task");
  });
});
