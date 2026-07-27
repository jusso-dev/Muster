import { describe, expect, it } from "vitest";
import { environmentConnectorTestMode } from "./bootstrap-connectors.ts";

describe("environment connector bootstrap", () => {
  it("permits scoped HTTP homelab connectors without weakening HTTPS connectors", () => {
    expect(environmentConnectorTestMode("http://tawny.internal:5080")).toBe(
      true,
    );
    expect(environmentConnectorTestMode("https://unifi.internal")).toBe(false);
  });
});
