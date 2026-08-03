import { Mastra } from "@mastra/core";
import { musterOpsAgent } from "./agent.ts";

export const mastra = new Mastra({
  agents: { musterOpsAgent },
});

export { musterOpsAgent } from "./agent.ts";
export { opsTools } from "./tools.ts";
