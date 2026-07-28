import { randomUUID } from "node:crypto";
import { closeDatabase, database } from "@muster/database";
import { createInstallation } from "./installation.ts";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

async function main() {
  const organisationId = arg("org");
  const boundActorId = arg("actor");
  const name = arg("name") ?? "Hermes MCP installation";
  const installedByActorId = arg("installed-by") ?? boundActorId;
  if (!organisationId || !boundActorId || !installedByActorId) {
    console.error(
      "Usage: pnpm --filter @muster/mcp create-installation --org=<organisationId> --actor=<boundActorId> [--name=<label>] [--installed-by=<actorId>]",
    );
    process.exitCode = 1;
    return;
  }
  const db = database();
  try {
    const { id, token } = await createInstallation(db, {
      organisationId,
      boundActorId,
      installedByActorId,
      name,
      traceId: randomUUID(),
    });
    console.log(
      JSON.stringify(
        {
          installationId: id,
          token,
          warning:
            "Store this token now. It is hashed at rest and cannot be recovered or displayed again.",
        },
        null,
        2,
      ),
    );
  } finally {
    await closeDatabase();
  }
}

void main();
