import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const shellUrl = new URL("./company-os-shell.tsx", import.meta.url);
const opsShellUrl = new URL("../ops-shell.tsx", import.meta.url);

describe("Company OS shell foundation", () => {
  it("defines the full primary navigation set", async () => {
    const source = await readFile(shellUrl, "utf8");
    for (const label of [
      "Command",
      "Operations",
      "Missions",
      "Teams",
      "Agents",
      "Capabilities",
      "Approvals",
      "Audit",
      "Integrations",
      "Settings",
    ]) {
      expect(source).toContain(`label: "${label}"`);
    }
  });

  it("keeps organisation switcher non-authoritative and disabled until multi-org exists", async () => {
    const source = await readFile(shellUrl, "utf8");
    expect(source).toContain('id="org-switcher"');
    expect(source).toContain("disabled");
    expect(source).toContain("localStorage.setItem(\"muster-theme\"");
    expect(source).not.toMatch(/localStorage\.setItem\([^\)]*organisation/i);
    expect(source).not.toMatch(/localStorage\.setItem\([^\)]*approval/i);
  });

  it("re-exports OpsShell from CompanyOsShell", async () => {
    const source = await readFile(opsShellUrl, "utf8");
    expect(source).toContain("CompanyOsShell");
    expect(source).toContain('from "@/components/os/company-os-shell"');
  });
});
