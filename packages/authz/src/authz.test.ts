import { describe, expect, it } from "vitest";
import {
  assertExecutableApproval,
  requireCapability,
  starterRoleCapabilities,
} from "./index";

describe("capabilities", () => {
  it("does not grant dangerous endpoint actions to analysts", () => {
    expect(starterRoleCapabilities.analyst).not.toContain(
      "tawny.response.isolate_host",
    );
  });

  it("rejects a missing server-side capability", () => {
    expect(() =>
      requireCapability(
        {
          actorId: "actor",
          organisationId: "org",
          capabilities: new Set(["rooms.read"]),
        },
        "alerts.dismiss",
      ),
    ).toThrow("Missing capability");
  });

  it("requires distinct humans for two-person detection publication", () => {
    expect(() =>
      assertExecutableApproval("detection.publish", [
        { actorId: "one", status: "approved" },
        { actorId: "one", status: "approved" },
      ]),
    ).toThrow("Approval requirement not met");
  });
});
