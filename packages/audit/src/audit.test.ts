import { describe, expect, it } from "vitest";
import {
  hashAuditEvent,
  normaliseAuditMetadata,
  verifyAuditIntegrity,
  verifyAuditChain,
  type HashableAuditEvent,
} from "./index";

const base: HashableAuditEvent = {
  organisationId: "org",
  sequence: 1,
  actorId: "actor",
  actorType: "human",
  action: "room.message.created",
  targetType: "message",
  targetId: "message",
  previousHash: "0".repeat(64),
  metadata: { safe: true },
  traceId: "trace",
  createdAt: "2026-07-26T00:00:00.000Z",
};

describe("audit chain", () => {
  it("detects metadata tampering", () => {
    const event = { ...base, eventHash: hashAuditEvent(base) };
    expect(verifyAuditChain([event]).valid).toBe(true);
    expect(verifyAuditIntegrity([event])).toMatchObject({
      outcome: "strict-valid",
      strict: { valid: true },
      legacyCompatible: { valid: true },
      legacyApprovalIdOmissions: [],
      historicalChainRepaired: false,
    });
    expect(
      verifyAuditChain([{ ...event, metadata: { safe: false } }]).valid,
    ).toBe(false);
  });

  it("hashes the same JSON representation that PostgreSQL persists", () => {
    const metadata = normaliseAuditMetadata({
      operation: "kelpie.timeline.comment",
      approvalId: undefined,
      nested: { omitted: undefined, kept: true },
      array: [undefined, "kept"],
    });
    expect(metadata).toEqual({
      operation: "kelpie.timeline.comment",
      nested: { kept: true },
      array: [null, "kept"],
    });

    const event = { ...base, metadata };
    const persisted = JSON.parse(JSON.stringify(event)) as HashableAuditEvent;
    expect(hashAuditEvent(event)).toBe(hashAuditEvent(persisted));
    expect(
      verifyAuditChain([
        { ...persisted, eventHash: hashAuditEvent(persisted) },
      ]),
    ).toEqual({ valid: true });
  });

  it("reports the legacy undefined approvalId defect without calling it repaired", () => {
    const historicalInput = {
      ...base,
      action: "integration.action.queued",
      metadata: {
        integrationId: "integration",
        operation: "alerts.list",
        capability: "alerts.read",
        approvalId: undefined,
      },
    };
    const historicalEvent = {
      ...historicalInput,
      metadata: {
        integrationId: "integration",
        operation: "alerts.list",
        capability: "alerts.read",
      },
      eventHash: hashAuditEvent(historicalInput),
    };
    const followingInput = {
      ...base,
      sequence: 2,
      targetId: "delivery",
      previousHash: historicalEvent.eventHash,
    };
    const followingEvent = {
      ...followingInput,
      eventHash: hashAuditEvent(followingInput),
    };

    expect(verifyAuditChain([historicalEvent, followingEvent])).toEqual({
      valid: false,
      brokenAt: 1,
    });
    expect(
      verifyAuditIntegrity([historicalEvent, followingEvent]),
    ).toMatchObject({
      outcome: "legacy-compatible-not-strict",
      strict: { valid: false, brokenAt: 1 },
      legacyCompatible: { valid: true },
      legacyApprovalIdOmissions: [{ sequence: 1 }],
      historicalChainRepaired: false,
    });
  });

  it("does not accept an unexplained hash mismatch as legacy-compatible", () => {
    const event = { ...base, eventHash: "0".repeat(64) };

    expect(verifyAuditIntegrity([event])).toMatchObject({
      outcome: "invalid",
      strict: { valid: false, brokenAt: 1 },
      legacyCompatible: { valid: false, brokenAt: 1 },
      legacyApprovalIdOmissions: [],
      historicalChainRepaired: false,
    });
  });
});
