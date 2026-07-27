import { describe, expect, it } from "vitest";
import {
  assertThreadBelongsToOrganisation,
  CheckpointScopeViolationError,
  parseThreadId,
  runNamespaceFor,
  runtimeScope,
  threadIdFor,
  type RuntimeScope,
} from "./identity.ts";

const organisationId = "00000000-0000-4000-8000-000000000001";
const agentId = "00000000-0000-4000-8000-00000000a001";
const runId = "00000000-0000-4000-8000-00000000b001";
const conversationId = "conversation-1";

const scope: RuntimeScope = { organisationId, agentId, conversationId, runId };

describe("threadIdFor / runNamespaceFor", () => {
  it("produces the documented muster:{org}:{agent}:{conversation} format", () => {
    expect(threadIdFor(scope)).toBe(
      `muster:${organisationId}:${agentId}:${conversationId}`,
    );
  });

  it("produces the documented muster:{org}:{agent}:{run} format", () => {
    expect(runNamespaceFor(scope)).toBe(
      `muster:${organisationId}:${agentId}:${runId}`,
    );
  });
});

describe("parseThreadId", () => {
  it("round-trips a thread id produced by threadIdFor", () => {
    const threadId = threadIdFor(scope);
    expect(parseThreadId(threadId)).toEqual({
      organisationId,
      agentId,
      conversationId,
    });
  });

  it("returns null for a non-muster prefix", () => {
    expect(
      parseThreadId(`other:${organisationId}:${agentId}:${conversationId}`),
    ).toBeNull();
  });

  it("returns null for too few segments", () => {
    expect(parseThreadId(`muster:${organisationId}:${agentId}`)).toBeNull();
    expect(parseThreadId("muster")).toBeNull();
  });

  it("handles a conversation id that itself contains a colon", () => {
    const nestedConversationId = "room:general:thread:42";
    const threadId = threadIdFor({
      organisationId,
      agentId,
      conversationId: nestedConversationId,
    });
    expect(parseThreadId(threadId)).toEqual({
      organisationId,
      agentId,
      conversationId: nestedConversationId,
    });
  });
});

describe("assertThreadBelongsToOrganisation", () => {
  it("returns the parsed thread when the organisation matches", () => {
    const threadId = threadIdFor(scope);
    expect(assertThreadBelongsToOrganisation(threadId, organisationId)).toEqual({
      organisationId,
      agentId,
      conversationId,
    });
  });

  it("throws CheckpointScopeViolationError for a foreign organisation", () => {
    const threadId = threadIdFor(scope);
    const foreignOrganisationId = "00000000-0000-4000-8000-000000000099";
    expect(() =>
      assertThreadBelongsToOrganisation(threadId, foreignOrganisationId),
    ).toThrow(CheckpointScopeViolationError);
  });

  it("throws CheckpointScopeViolationError for a malformed thread", () => {
    expect(() =>
      assertThreadBelongsToOrganisation("not-a-muster-thread", organisationId),
    ).toThrow(CheckpointScopeViolationError);
  });
});

describe("runtimeScope", () => {
  it("accepts a well-formed scope", () => {
    expect(runtimeScope(scope)).toEqual(scope);
  });

  it("rejects a non-uuid organisationId", () => {
    expect(() =>
      runtimeScope({ ...scope, organisationId: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects a non-uuid agentId", () => {
    expect(() => runtimeScope({ ...scope, agentId: "not-a-uuid" })).toThrow();
  });

  it("rejects a non-uuid runId", () => {
    expect(() => runtimeScope({ ...scope, runId: "not-a-uuid" })).toThrow();
  });

  it("rejects an empty conversationId", () => {
    expect(() => runtimeScope({ ...scope, conversationId: "" })).toThrow();
  });
});
