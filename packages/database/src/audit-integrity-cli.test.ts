import { describe, expect, it } from "vitest";
import { hashAuditEvent, verifyAuditIntegrity } from "@muster/audit";
import type { HashableAuditEvent } from "@muster/audit";
import {
  RUNBOOK,
  auditIntegrityExitCodes,
  describeAuditIntegrity,
  resolveAuditOrganisationId,
} from "./audit-integrity-cli.ts";

const organisationId = "018f55d8-c4c7-7c3e-88ef-000000000001";
const base: HashableAuditEvent = {
  organisationId,
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

function legacyEvent() {
  const input = {
    ...base,
    action: "integration.action.queued",
    metadata: { operation: "alerts.list", approvalId: undefined },
  };
  return {
    ...input,
    metadata: { operation: "alerts.list" },
    eventHash: hashAuditEvent(input),
  };
}

describe("audit organisation id resolution", () => {
  it("accepts a UUID from either the environment or the flag", () => {
    expect(resolveAuditOrganisationId(` ${organisationId} `)).toEqual({
      organisationId,
    });
  });

  it("lists candidate organisations when none was supplied", () => {
    const resolved = resolveAuditOrganisationId(undefined, [
      { id: organisationId, slug: "muster", name: "Muster Workspace" },
    ]);
    expect(resolved).not.toHaveProperty("organisationId");
    const usage = "usage" in resolved ? resolved.usage : "";
    expect(usage).toContain("MUSTER_AUDIT_ORGANISATION_ID is not set");
    expect(usage).toContain(organisationId);
    expect(usage).toContain("muster");
    expect(usage).toContain(RUNBOOK);
  });

  it("explains a malformed id instead of failing anonymously", () => {
    const resolved = resolveAuditOrganisationId("not-a-uuid");
    expect("usage" in resolved && resolved.usage).toContain("not a UUID");
  });

  it("says so when no organisation could be listed", () => {
    const resolved = resolveAuditOrganisationId(undefined, []);
    expect("usage" in resolved && resolved.usage).toContain("DATABASE_URL");
  });
});

describe("audit integrity interpretation", () => {
  it("reports a clean chain without ambiguity", () => {
    const report = verifyAuditIntegrity([
      { ...base, eventHash: hashAuditEvent(base) },
    ]);
    expect(auditIntegrityExitCodes[report.outcome]).toBe(0);
    expect(describeAuditIntegrity(report)).toContain(
      "Strict verification passed",
    );
  });

  it("names the failing sequence and forbids repair for a legacy omission", () => {
    const report = verifyAuditIntegrity([legacyEvent()]);
    expect(report.outcome).toBe("legacy-compatible-not-strict");
    expect(auditIntegrityExitCodes[report.outcome]).toBe(2);

    const description = describeAuditIntegrity(report);
    expect(description).toContain("failed at sequence 1");
    expect(description).toContain("approvalId omission");
    expect(description).toContain("Do not mutate any audit row");
    expect(description).toContain(RUNBOOK);
    expect(description).not.toMatch(/repair(ed)? the chain/i);
  });

  it("escalates an unexplained mismatch as a possible incident", () => {
    const report = verifyAuditIntegrity([
      { ...base, eventHash: "0".repeat(64) },
    ]);
    expect(auditIntegrityExitCodes[report.outcome]).toBe(1);

    const description = describeAuditIntegrity(report);
    expect(description).toContain("no known legacy reconstruction");
    expect(description).toContain("Preserve the rows exactly as stored");
  });

  it("separates operator error and outage from chain failure", () => {
    expect(auditIntegrityExitCodes.usage).toBe(64);
    expect(auditIntegrityExitCodes.unavailable).toBe(69);
  });
});
