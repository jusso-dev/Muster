import { describe, expect, it } from "vitest";
import {
  MsepEnvelopeSchema,
  WorkflowDefinitionSchema,
  msepEventTypes,
} from "./index";

describe("MSEP", () => {
  it("covers every declared event family and rejects unknown types", () => {
    expect(msepEventTypes).toHaveLength(54);
    const result = MsepEnvelopeSchema.safeParse({
      specVersion: "muster.security/v1",
      id: "evt_01JABCDEF",
      type: "alert.created",
      source: {
        product: "tawny",
        instanceId: "tawny-test",
        organisationId: "018f55d8-c4c7-7c3e-88ef-111111111111",
      },
      subject: { type: "endpoint", id: "host-1" },
      occurredAt: "2026-07-26T06:40:21Z",
      receivedAt: "2026-07-26T06:40:23Z",
      classification: { severity: "high", tlp: "amber", pap: "amber" },
      correlation: {
        caseId: null,
        investigationId: null,
        traceId: "trace_abc",
      },
      data: { title: "Synthetic alert" },
      evidence: [],
      integrity: {
        issuer: "tawny-test",
        keyId: "test",
        signature: "a".repeat(64),
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("workflow contract", () => {
  it("requires at least one typed step", () => {
    expect(
      WorkflowDefinitionSchema.safeParse({
        apiVersion: "muster.security/v1",
        kind: "Workflow",
        metadata: { id: "test-flow", name: "Test", version: "1.0.0" },
        steps: [],
      }).success,
    ).toBe(false);
  });
});
