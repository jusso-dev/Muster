import { randomUUID } from "node:crypto";
import { AgentHarnessHttpClient } from "./portable-client.ts";
import { clientOptionsFromEnvironment } from "./mcp.ts";

type CliOutput = { log(value: string): void };

export async function runHarnessCli(
  arguments_: string[],
  client: AgentHarnessHttpClient,
  output: CliOutput = console,
) {
  const [command, ...rest] = arguments_;
  if (command === "list" && rest.length === 0) {
    output.log(JSON.stringify(await client.manifest(), null, 2));
    return;
  }
  if (command === "get" && rest.length === 1) {
    output.log(JSON.stringify(await client.read(rest[0]!), null, 2));
    return;
  }
  if (command === "cancel" && rest.length === 1) {
    output.log(JSON.stringify(await client.cancel(rest[0]!), null, 2));
    return;
  }
  if (command === "invoke") {
    const values = Object.fromEntries(
      rest
        .filter((value) => value.startsWith("--"))
        .map((value) => {
          const [name, ...parts] = value.slice(2).split("=");
          return [name, parts.join("=")];
        }),
    );
    const agentKey = values.agent;
    const prompt = values.prompt;
    if (!agentKey || !prompt)
      throw new Error("invoke requires --agent=NAME and --prompt=TEXT");
    output.log(
      JSON.stringify(
        await client.invoke(
          {
            agentKey,
            mode: "cli",
            input: {
              prompt,
              ...(values.room ? { roomId: values.room } : {}),
              ...(values.investigation
                ? { investigationId: values.investigation }
                : {}),
              ...(values.task ? { taskId: values.task } : {}),
              ...(values.case ? { caseId: values.case } : {}),
            },
            ...(values.correlation
              ? { correlationId: values.correlation }
              : {}),
          },
          values.idempotency ?? randomUUID(),
        ),
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(
    "Usage: list | get RUN_ID | cancel RUN_ID | invoke --agent=NAME --prompt=TEXT [--idempotency=KEY]",
  );
}

async function main() {
  await runHarnessCli(
    process.argv.slice(2),
    new AgentHarnessHttpClient(clientOptionsFromEnvironment()),
  );
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file:${process.argv[1]}`).href
)
  void main();
