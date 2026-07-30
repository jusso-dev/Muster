import { describe, expect, it } from "vitest";
import { capabilities } from "@muster/authz";
import {
  evaluatePackHandoff,
  packHandoffTargets,
  PACK_HANDOFF_AGENTS,
  PACK_HANDOFF_EDGES,
} from "./pack-handoff-policy.ts";

const base = {
  requestedCapabilities: [] as string[],
  knownCapabilities: capabilities as readonly string[],
};

describe("pack handoff policy graph", () => {
  it("allows the documented routes", () => {
    for (const edge of PACK_HANDOFF_EDGES) {
      const decision = evaluatePackHandoff({
        ...base,
        from: edge.from,
        to: edge.to,
        reason: edge.reasons[0]!,
      });
      expect(decision.allowed, `${edge.from}->${edge.to}`).toBe(true);
    }
  });

  it("refuses a free mesh: Alfie cannot hand back to Jessie", () => {
    const decision = evaluatePackHandoff({
      ...base,
      from: "Alfie",
      to: "Jessie",
      reason: "hunt",
    });
    expect(decision).toMatchObject({ allowed: false, code: "edge_not_allowed" });
  });

  it("refuses every unlisted ordered pair", () => {
    const allowed = new Set(
      PACK_HANDOFF_EDGES.map((edge) => `${edge.from}->${edge.to}`),
    );
    for (const from of PACK_HANDOFF_AGENTS) {
      for (const to of PACK_HANDOFF_AGENTS) {
        if (from === to || allowed.has(`${from}->${to}`)) continue;
        for (const reason of [
          "triage",
          "hunt",
          "research",
          "reporting",
          "response",
        ]) {
          expect(
            evaluatePackHandoff({ ...base, from, to, reason }).allowed,
            `${from}->${to} (${reason})`,
          ).toBe(false);
        }
      }
    }
  });

  it("refuses self-handoff and unknown agents", () => {
    expect(
      evaluatePackHandoff({ ...base, from: "Parker", to: "Parker", reason: "triage" }),
    ).toMatchObject({ code: "self_handoff" });
    expect(
      evaluatePackHandoff({ ...base, from: "Parker", to: "Hermes", reason: "triage" }),
    ).toMatchObject({ code: "unknown_agent" });
  });

  it("refuses a reason the edge does not carry", () => {
    expect(
      evaluatePackHandoff({
        ...base,
        from: "Jessie",
        to: "Alfie",
        reason: "response",
      }),
    ).toMatchObject({ code: "reason_not_allowed" });
  });

  it("refuses capabilities outside the known catalogue", () => {
    expect(
      evaluatePackHandoff({
        ...base,
        from: "Parker",
        to: "Jessie",
        reason: "hunt",
        requestedCapabilities: ["tawny.response.everything"],
      }),
    ).toMatchObject({ code: "unknown_capability" });
  });

  it("requires approval for state-changing capabilities", () => {
    const decision = evaluatePackHandoff({
      ...base,
      from: "Parker",
      to: "Jessie",
      reason: "hunt",
      requestedCapabilities: ["tawny.telemetry.read", "tawny.response.isolate_host"],
    });
    expect(decision).toMatchObject({ allowed: true, requiresApproval: true });
    expect(
      decision.allowed ? decision.highRiskCapabilities : [],
    ).toEqual(["tawny.response.isolate_host"]);
  });

  it("requires approval for any response-reason handoff", () => {
    expect(
      evaluatePackHandoff({
        ...base,
        from: "Parker",
        to: "Jessie",
        reason: "response",
      }),
    ).toMatchObject({ allowed: true, requiresApproval: true });
  });

  it("does not require approval for a plain read-only route", () => {
    expect(
      evaluatePackHandoff({
        ...base,
        from: "Parker",
        to: "Alfie",
        reason: "research",
        requestedCapabilities: ["research.feeds.read"],
      }),
    ).toMatchObject({ allowed: true, requiresApproval: false });
  });

  it("reports only reachable targets", () => {
    expect(packHandoffTargets("Alfie")).toEqual(["Parker"]);
    expect(packHandoffTargets("Hermes")).toEqual([]);
  });
});
