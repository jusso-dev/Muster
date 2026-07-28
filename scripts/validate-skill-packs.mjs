#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = resolve(root, "skills/policy-bundle.json");
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const allowedTools = new Set(Object.keys(bundle.tools));
const requiredSections = [
  "## Triggers",
  "## Permitted MCP tools",
  "## Evidence standards",
  "## Approval boundaries",
  "## Refusal conditions",
  "## Output format",
  "## Verification",
];

const errors = [];
if (!bundle.version) errors.push("policy-bundle missing version");
if (bundle.skillsContainCredentials !== false)
  errors.push("skillsContainCredentials must be false");
if (bundle.skillsMayNotExpandCapabilities !== true)
  errors.push("skillsMayNotExpandCapabilities must be true");

for (const pack of bundle.packs ?? []) {
  const skillPath = resolve(root, "skills", pack.path);
  if (!existsSync(skillPath)) {
    errors.push(`missing skill file: ${pack.path}`);
    continue;
  }
  const body = readFileSync(skillPath, "utf8");
  if (!body.includes(`name: ${pack.key}`) && !body.includes(`name: ${pack.key}\n`)) {
    // frontmatter name may use exact key
    if (!body.match(new RegExp(`^name:\\s*${pack.key}\\s*$`, "m")))
      errors.push(`${pack.key}: frontmatter name mismatch`);
  }
  for (const section of requiredSections) {
    if (!body.includes(section))
      errors.push(`${pack.key}: missing section ${section}`);
  }
  if (body.match(/sk-[A-Za-z0-9]{10,}/) || body.match(/klp_[A-Za-z0-9]+/))
    errors.push(`${pack.key}: looks like an embedded credential`);
  const toolLines = [...body.matchAll(/muster_[a-z0-9_]+/g)].map((m) => m[0]);
  for (const tool of new Set(toolLines)) {
    if (!allowedTools.has(tool))
      errors.push(`${pack.key}: unknown tool ${tool}`);
  }
}

const report = {
  ok: errors.length === 0,
  bundle: { name: bundle.name, version: bundle.version },
  packs: (bundle.packs ?? []).map((p) => p.key),
  errors,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(errors.length === 0 ? 0 : 1);
