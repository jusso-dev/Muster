import { describe, expect, it } from "vitest";
import {
  AGENT_RUNTIME_GRAPH_VERSION,
  checkGraphVersion,
} from "./version.ts";

describe("checkGraphVersion", () => {
  it("is compatible for the current runtime graph version", () => {
    expect(checkGraphVersion(AGENT_RUNTIME_GRAPH_VERSION)).toEqual({
      compatible: true,
    });
  });

  it("is incompatible with migrationRequired for null", () => {
    const result = checkGraphVersion(null);
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.migrationRequired).toBe(true);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("is incompatible with migrationRequired for an empty string", () => {
    const result = checkGraphVersion("");
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.migrationRequired).toBe(true);
    }
  });

  it("is incompatible for an unknown version and names both the recorded and current version", () => {
    const unknown = "muster.agent-runtime.graph/999";
    const result = checkGraphVersion(unknown);
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.migrationRequired).toBe(true);
      expect(result.reason).toContain(unknown);
      expect(result.reason).toContain(AGENT_RUNTIME_GRAPH_VERSION);
    }
  });
});
