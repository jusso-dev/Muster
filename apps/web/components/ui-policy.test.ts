import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = new URL("../", import.meta.url);

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = new URL(
        `${entry.name}${entry.isDirectory() ? "/" : ""}`,
        directory,
      );
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          return [];
        }
        return sourceFiles(path);
      }
      return [path];
    }),
  );
  return nested.flat();
}

describe("Muster UI policy", () => {
  it("keeps typography scalable and avoids prohibited decoration", async () => {
    const violations: string[] = [];
    const files = (await sourceFiles(sourceRoot)).filter((file) =>
      [".css", ".tsx"].includes(extname(file.pathname)),
    );
    const policies = [
      { label: "fixed pixel text", pattern: /text-\[\d+px\]/g },
      { label: "gradient", pattern: /\b(?:bg-gradient|from-|via-|to-)/g },
      {
        label: "glow",
        pattern: /(?:drop-shadow|shadow-\[[^\]]*(?:accent|agent|focus))/g,
      },
      { label: "side stripe", pattern: /\bborder-[lr]-[2-9]\b/g },
    ];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const policy of policies) {
        if (policy.pattern.test(source)) {
          violations.push(
            `${join("app", file.pathname.split("/app/").at(-1) ?? file.pathname)}: ${policy.label}`,
          );
        }
        policy.pattern.lastIndex = 0;
      }
    }

    expect(violations).toEqual([]);
  });
});
