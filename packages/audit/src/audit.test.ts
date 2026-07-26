import { describe, expect, it } from "vitest";
import { hashAuditEvent, verifyAuditChain, type HashableAuditEvent } from "./index";

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
    expect(
      verifyAuditChain([{ ...event, metadata: { safe: false } }]).valid,
    ).toBe(false);
  });
});
