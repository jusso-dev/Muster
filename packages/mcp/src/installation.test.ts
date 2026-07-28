import { describe, expect, it } from "vitest";
import { hashInstallationToken, requireScope } from "./installation.ts";

describe("hashInstallationToken", () => {
  it("is deterministic and never returns the plaintext token", () => {
    const token = "muster_mcp_synthetic-secret-canary";
    const hash = hashInstallationToken(token);
    expect(hash).toBe(hashInstallationToken(token));
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs for different tokens", () => {
    expect(hashInstallationToken("muster_mcp_a")).not.toBe(
      hashInstallationToken("muster_mcp_b"),
    );
  });
});

describe("requireScope", () => {
  const baseContext = {
    installationId: "installation-1",
    installationName: "Synthetic",
    actorType: "service" as const,
    subject: {
      actorId: "actor-1",
      organisationId: "org-1",
      capabilities: new Set<never>(),
    },
  };

  it("allows a tool present in the installation's scopes", () => {
    expect(() =>
      requireScope(
        { ...baseContext, scopes: ["muster_get_status"] },
        "muster_get_status",
      ),
    ).not.toThrow();
  });

  it("denies a tool that model-supplied arguments cannot add back", () => {
    expect(() =>
      requireScope(
        { ...baseContext, scopes: ["muster_get_status"] },
        "muster_search_kelpie_cases",
      ),
    ).toThrow(/not scoped/);
  });
});
