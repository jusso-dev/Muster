import { describe, expect, it } from "vitest";
import { taskStatusAfterAgentRun } from "./task-domain";

describe("task agent-run transitions", () => {
  it("moves completed work to human review", () => {
    expect(taskStatusAfterAgentRun("completed")).toBe("review");
  });

  it.each(["failed", "cancelled"] as const)(
    "returns %s work to ready for visible retry",
    (status) => {
      expect(taskStatusAfterAgentRun(status)).toBe("ready");
    },
  );
});
