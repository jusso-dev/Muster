import { describe, expect, it } from "vitest";
import { mayPublishSkill, prepareSkillProposal } from "./index";

describe("agent learning governance", () => {
  it("keeps self-authored skills untrusted until reviewed", () => {
    const proposal = prepareSkillProposal({
      skillKey: "correlate-legacy-auth",
      name: "Correlate legacy authentication",
      description: "Correlates semantic authentication events with endpoint activity.",
      content:
        "# Correlate legacy authentication\n\nUse only organisation-scoped evidence. Compare identity, source IP, endpoint ownership, and a bounded time window. Record contradictory evidence and cite every result.",
      changeRationale: "Two completed investigations used the same validated procedure.",
      evidenceReferences: ["run_01", "decision_01"],
      requiredCapabilities: ["alerts.read"],
      allowedTools: ["knowledge.search"],
    });
    expect(proposal.trusted).toBe(false);
    expect(proposal.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires evaluation, no regression, and human approval", () => {
    expect(
      mayPublishSkill(
        { passed: true, score: 92, baselineScore: 88, regressions: [] },
        true,
      ).allowed,
    ).toBe(true);
    expect(
      mayPublishSkill(
        { passed: true, score: 92, baselineScore: 88, regressions: [] },
        false,
      ).allowed,
    ).toBe(false);
  });
});
