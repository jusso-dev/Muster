import { describe, expect, it } from "vitest";
import { signMsep, verifyMsep } from "./index";

describe("MSEP signatures", () => {
  it("rejects modified event data", () => {
    const signed = signMsep(
      {
        specVersion: "muster.security/v1",
        id: "evt_01JABCDEFG",
        type: "alert.created",
        source: {
          product: "test",
          instanceId: "test",
          organisationId: "018f55d8-c4c7-7c3e-88ef-111111111111",
        },
        subject: { type: "alert", id: "one" },
        occurredAt: "2026-07-26T00:00:00Z",
        receivedAt: "2026-07-26T00:00:00Z",
        classification: { severity: "high", tlp: "amber", pap: "amber" },
        correlation: {
          caseId: null,
          investigationId: null,
          traceId: "trace-test",
        },
        data: { title: "Synthetic" },
        evidence: [],
      },
      "secret",
      "test",
      "key",
    );
    expect(() =>
      verifyMsep({ ...signed, data: { title: "Changed" } }, "secret"),
    ).toThrow("signature");
  });
});
