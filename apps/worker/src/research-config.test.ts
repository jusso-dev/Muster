import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function repositoryFile(path: string) {
  return readFileSync(new URL(path, `file://${repositoryRoot}/`), "utf8");
}

function extractComposeService(compose: string, service: string) {
  const match = compose.match(
    new RegExp(
      `\\n  ${service}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z][\\w-]*:|\\n[a-zA-Z]|$)`,
    ),
  );
  if (!match?.[1]) {
    throw new Error(`Compose service block not found: ${service}`);
  }
  return match[1];
}

describe("Alfie homelab research configuration", () => {
  it("passes an explicitly configured feed-origin allowlist to web and worker only", () => {
    const compose = repositoryFile("deploy/docker/docker-compose.homelab.yml");
    const allowlist =
      /MUSTER_RESEARCH_ALLOWED_FEED_ORIGINS: \$\{MUSTER_RESEARCH_ALLOWED_FEED_ORIGINS:-\}/;
    const web = extractComposeService(compose, "web");
    const worker = extractComposeService(compose, "worker");
    const postgres = extractComposeService(compose, "postgres");
    expect(web).toMatch(allowlist);
    expect(worker).toMatch(allowlist);
    expect(postgres).not.toMatch(/MUSTER_RESEARCH_ALLOWED_FEED_ORIGINS/);
  });

  it("documents an empty safe default without enabling a mock origin", () => {
    for (const path of [".env.example", "deploy/docker/.env.homelab.example"]) {
      const example = repositoryFile(path);
      expect(example).toMatch(/^MUSTER_RESEARCH_ALLOWED_FEED_ORIGINS=$/m);
      expect(example).not.toMatch(
        /^MUSTER_RESEARCH_ALLOWED_FEED_ORIGINS=.*https?:/m,
      );
    }
    expect(repositoryFile("docs/operations/alfie-research.md")).toContain(
      "Homelab Compose passes this value unchanged to web and worker services",
    );
  });
});
