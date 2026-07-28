import { describe, expect, it } from "vitest";
import { KnowledgeProposalSchema } from "./knowledge.ts";

describe("KnowledgeProposalSchema policy surface", () => {
  it("requires evidence references and stable idempotency keys", () => {
    expect(() =>
      KnowledgeProposalSchema.parse({
        kind: "fact",
        title: "Host is managed",
        content: "Endpoint inventory lists host A.",
        evidenceReferences: [],
        idempotencyKey: "idem-12345678",
      }),
    ).toThrow();

    const ok = KnowledgeProposalSchema.parse({
      kind: "fact",
      title: "Host is managed",
      content: "Endpoint inventory lists host A.",
      evidenceReferences: ["evidence:inventory-1"],
      idempotencyKey: "idem-12345678",
    });
    expect(ok.kind).toBe("fact");
  });
});
