import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const codexCli = require.resolve("@openai/codex/bin/codex.js");
const child = spawn(process.execPath, [codexCli, "login", "--device-auth"], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
