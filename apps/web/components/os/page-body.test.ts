import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const featureRoot = new URL("../../features/", import.meta.url);

async function viewFiles(): Promise<URL[]> {
  const groups = await readdir(featureRoot, { withFileTypes: true });
  const found: URL[] = [];
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const dir = new URL(`${group.name}/`, featureRoot);
    for (const entry of await readdir(dir)) {
      if (entry.endsWith("-view.tsx")) found.push(new URL(entry, dir));
    }
  }
  return found;
}

describe("OS page layout", () => {
  it("routes every feature view through the shared container", async () => {
    const offenders: string[] = [];
    for (const file of await viewFiles()) {
      const source = await readFile(file, "utf8");
      // Sub-components (drawers, cards) may set their own width; only the
      // page-level container is standardised.
      if (!source.includes("<CompanyOsShell>")) continue;
      if (!source.includes("<PageBody")) {
        offenders.push(file.pathname.split("/features/").at(-1) ?? "");
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps eyebrows to the sidebar's group vocabulary", async () => {
    const allowed = new Set(["Operate", "Workforce", "Govern", "Configure"]);
    const shell = await readFile(
      new URL("./company-os-shell.tsx", import.meta.url),
      "utf8",
    );
    for (const heading of allowed) {
      expect(shell, `sidebar is missing the ${heading} group`).toContain(
        `heading: "${heading}"`,
      );
    }

    const offenders: string[] = [];
    for (const file of await viewFiles()) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/eyebrow="([^"]+)"/g)) {
        if (!allowed.has(match[1]!)) offenders.push(match[1]!);
      }
    }
    expect(offenders).toEqual([]);
  });
});
