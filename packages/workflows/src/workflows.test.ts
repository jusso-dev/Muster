import { describe, expect, it } from "vitest";
import { evaluateCondition, parseWorkflow } from "./index";

const sample = `
apiVersion: muster.security/v1
kind: Workflow
metadata:
  id: suspicious-powershell-triage
  name: Suspicious PowerShell triage
  version: 1.0.0
steps:
  - id: create-investigation
    action: muster.investigations.create
  - id: analyst-review
    approval:
      capability: investigations.promote
      timeout: 30m
  - id: promote
    when: "{{ steps.analyst-review.decision == 'approved' }}"
    action: kelpie.case.create
`;

describe("workflow parsing", () => {
  it("parses a valid approval-gated workflow", () => {
    expect(parseWorkflow(sample).steps).toHaveLength(3);
  });

  it("evaluates only bounded equality expressions", () => {
    expect(
      evaluateCondition("{{ steps.review.decision == 'approved' }}", {
        steps: { review: { decision: "approved" } },
      }),
    ).toBe(true);
    expect(() => evaluateCondition("{{ process.exit() }}", {})).toThrow("Unsafe");
  });
});
