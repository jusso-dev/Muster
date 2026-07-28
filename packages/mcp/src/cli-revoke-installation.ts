import { randomUUID } from "node:crypto";
import { closeDatabase, database } from "@muster/database";
import { revokeInstallation } from "./installation.ts";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

async function main() {
  const organisationId = arg("org");
  const installationId = arg("installation");
  const revokedByActorId = arg("actor");
  if (!organisationId || !installationId || !revokedByActorId) {
    console.error(
      "Usage: pnpm --filter @muster/mcp revoke-installation --org=<organisationId> --installation=<installationId> --actor=<revokedByActorId>",
    );
    process.exitCode = 1;
    return;
  }
  const db = database();
  try {
    const revoked = await revokeInstallation(db, {
      organisationId,
      installationId,
      revokedByActorId,
      traceId: randomUUID(),
    });
    console.log(JSON.stringify({ installationId, revoked }, null, 2));
    if (!revoked) process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

void main();
