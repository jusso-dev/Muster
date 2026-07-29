import { describe, expect, it } from "vitest";
import {
  toApprovalState,
  toHealthState,
  toOperationalState,
} from "./status";

describe("status vocabulary mappers", () => {
  it("maps health strings", () => {
    expect(toHealthState("ready")).toBe("healthy");
    expect(toHealthState("degraded")).toBe("degraded");
    expect(toHealthState("unavailable")).toBe("unhealthy");
    expect(toHealthState("weird")).toBe("unknown");
  });

  it("maps approval states", () => {
    expect(toApprovalState("pending")).toBe("pending");
    expect(toApprovalState("approved")).toBe("approved");
    expect(toApprovalState("rejected")).toBe("rejected");
    expect(toApprovalState(null)).toBe("not-required");
  });

  it("maps operational task/run states", () => {
    expect(toOperationalState("backlog")).toBe("queued");
    expect(toOperationalState("in_progress")).toBe("running");
    expect(toOperationalState("done")).toBe("completed");
    expect(toOperationalState("failed")).toBe("failed");
  });
});
