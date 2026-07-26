import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentStructuredOutputSchemas,
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

describe("agent structured output contracts", () => {
  it("validates a typed HuntResult that separates facts from inference", () => {
    const reference = {
      type: "integration-query",
      reference: "integration-query:synthetic",
      sha256: null,
    };
    expect(
      AgentStructuredOutputSchemas.HuntResult.parse({
        title: "Synthetic hunt",
        summary: "One bounded source completed.",
        question: "What saw 192.0.2.4?",
        trainingMode: false,
        confidence: 0.7,
        queries: [
          {
            source: "Synthetic source",
            templateKey: "synthetic.events",
            status: "succeeded",
            recordCount: 1,
            evidenceReferences: [reference],
            gap: null,
          },
        ],
        observedFacts: [
          {
            statement: "One source observed the address.",
            source: "Synthetic source",
            confidence: 1,
            evidenceReferences: [reference],
          },
        ],
        inferences: [
          {
            statement: "Further review may be warranted.",
            basis: "One bounded observation.",
            confidence: 0.4,
            evidenceReferences: [reference],
          },
        ],
        observables: [
          {
            type: "ip",
            value: "192.0.2.4",
            normalizedValue: "192.0.2.4",
            confidence: 1,
            evidenceReferences: [reference],
          },
        ],
        attackMappings: [
          {
            techniqueId: "T1071.001",
            techniqueName: "Web Protocols",
            confidence: 0.4,
            evidenceReferences: [reference],
            supportingReferences: [
              "https://attack.mitre.org/techniques/T1071/001/",
            ],
          },
        ],
        evidenceReferences: [reference],
        gaps: [],
        recommendedNextSteps: ["Review evidence."],
        coachingNotes: [],
        enrichmentProposal: null,
      }),
    ).toMatchObject({ confidence: 0.7, trainingMode: false });
  });

  it("generates an OpenAI strict-compatible evidence-reference schema", () => {
    const schema = z.toJSONSchema(
      AgentStructuredOutputSchemas.TriageRecommendation,
      {
        target: "draft-2020-12",
        io: "output",
      },
    ) as unknown as {
      properties: {
        evidenceReferences: {
          items: { required?: string[]; properties: Record<string, unknown> };
        };
      };
    };
    const evidenceItem = schema.properties.evidenceReferences.items;

    expect(evidenceItem.required).toEqual(Object.keys(evidenceItem.properties));
    expect(
      AgentStructuredOutputSchemas.TriageRecommendation.safeParse({
        title: "Suspicious PowerShell",
        summary: "Synthetic recommendation",
        confidence: 0.9,
        evidenceReferences: [
          { type: "tawny.telemetry", reference: "telemetry_123", sha256: null },
        ],
        recommendedActions: ["Review endpoint activity"],
        disposition: "investigate",
        severity: "high",
        rationale: "Correlated endpoint activity",
      }).success,
    ).toBe(true);
  });
});
