import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

if (process.env.MUSTER_ALFIE_LIVE_SMOKE !== "true") {
  throw new Error(
    "Refusing live CISA smoke. Set MUSTER_ALFIE_LIVE_SMOKE=true.",
  );
}

const url =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error(`CISA KEV returned ${response.status}`);
const body = await response.text();
const feed = JSON.parse(body);
const citation = {
  source: "CISA Known Exploited Vulnerabilities Catalog",
  url,
  retrievedAt: new Date().toISOString(),
  sha256: createHash("sha256").update(body).digest("hex"),
  catalogVersion:
    typeof feed.catalogVersion === "string" ? feed.catalogVersion : null,
  citedCveIds: Array.isArray(feed.vulnerabilities)
    ? feed.vulnerabilities
        .slice(0, 3)
        .map((item) => item?.cveID)
        .filter((item) => typeof item === "string")
    : [],
};
const directory = resolve("artifacts");
await mkdir(directory, { recursive: true });
const path = resolve(
  directory,
  `alfie-cisa-smoke-${citation.retrievedAt.replaceAll(/[:.]/g, "-")}.json`,
);
await writeFile(path, `${JSON.stringify(citation, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${path}\n`);
