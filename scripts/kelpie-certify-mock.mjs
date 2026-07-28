#!/usr/bin/env node
/**
 * Prints a mock-only Kelpie certification summary for tracker #78 item 4.
 * Never claims local/deployed/live-verified status. Exit 0 when the mock
 * integration entry points exist and docs are present; exit 1 otherwise.
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "integrations/kelpie/mock.mjs",
  "docs/integrations/kelpie-certification.md",
  "docs/integrations/current-upstream-contracts.md",
  "packages/mcp/src/mcp.integration.test.ts",
  "packages/mcp/src/kelpie-gateway.ts",
];

const missing = required.filter((rel) => !existsSync(resolve(root, rel)));
const report = {
  certification: "kelpie",
  environment: "mock",
  timestamp: new Date().toISOString(),
  musterCommitHint: "see git rev-parse HEAD",
  checks: required.map((rel) => ({
    path: rel,
    status: missing.includes(rel) ? "missing" : "present",
  })),
  liveVerified: false,
  note: "Mock presence only. Run MUSTER_INTEGRATION_TESTS=true for mock behavioural suite. Do not treat this script as live certification.",
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (missing.length > 0) {
  process.stderr.write(
    `kelpie-certify-mock: missing ${missing.join(", ")}\n`,
  );
  process.exit(1);
}
