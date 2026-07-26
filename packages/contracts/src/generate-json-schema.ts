import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  AgentStructuredOutputSchemas,
  MsepEnvelopeSchema,
  ProblemSchema,
  WorkflowDefinitionSchema,
} from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(here, "../generated");
await mkdir(outputDirectory, { recursive: true });

const schemas = {
  MsepEnvelope: MsepEnvelopeSchema,
  Problem: ProblemSchema,
  WorkflowDefinition: WorkflowDefinitionSchema,
  ...AgentStructuredOutputSchemas,
};

for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
  });
  await writeFile(
    resolve(outputDirectory, `${name}.schema.json`),
    `${JSON.stringify(json, null, 2)}\n`,
    "utf8",
  );
}
