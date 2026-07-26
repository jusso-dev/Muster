import { spawn } from "node:child_process";

await import("/app/database/dist/migrate.js");
await import("/app/database/dist/seed.js");

const next = spawn(process.execPath, ["/app/web/apps/web/server.js"], {
  cwd: "/app/web/apps/web",
  env: { ...process.env, HOSTNAME: "0.0.0.0", PORT: "3000" },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => next.kill(signal));
}

next.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
