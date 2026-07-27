import { defineConfig, devices } from "@playwright/test";

const testDatabaseUrl =
  process.env.MUSTER_TEST_DATABASE_URL ??
  "postgresql://muster:muster@localhost:5432/muster";
const testRedisUrl =
  process.env.MUSTER_TEST_REDIS_URL ?? "redis://localhost:6379";

process.env.DATABASE_URL ??= testDatabaseUrl;

export default defineConfig({
  testDir: "./tests",
  testIgnore: "clean-install.spec.ts",
  globalSetup: "./tests/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.MUSTER_BASE_URL ?? "http://127.0.0.1:3000",
    storageState: ".playwright/auth.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      name: "Synthetic Kelpie",
      command: "PORT=4011 node integrations/kelpie/mock.mjs",
      url: "http://127.0.0.1:4011/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      name: "Synthetic Tawny",
      command: "PORT=4012 node integrations/tawny/mock.mjs",
      url: "http://127.0.0.1:4012/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      name: "Synthetic connector",
      command: "PORT=4123 node integrations/generic/mock.mjs",
      url: "http://127.0.0.1:4123/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      name: "Muster worker",
      command: `MUSTER_RESEARCH_TEST_MODE=true MUSTER_AGENT_GATEWAY_TOKEN=0707070707070707070707070707070707070707070707070707070707070707 CONNECTOR_ENCRYPTION_KEY=0707070707070707070707070707070707070707070707070707070707070707 DATABASE_URL=${testDatabaseUrl} REDIS_URL=${testRedisUrl} AGENT_GATEWAY_URL=http://127.0.0.1:3002 pnpm --dir apps/worker dev`,
      url: "http://127.0.0.1:3001/ready",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      name: "Muster agent gateway",
      command: `MUSTER_AGENT_RUNTIME=mock MUSTER_AGENT_GATEWAY_TOKEN=0707070707070707070707070707070707070707070707070707070707070707 MUSTER_MOCK_AGENT_DELAY_MS=5000 DATABASE_URL=${testDatabaseUrl} pnpm --dir apps/agent-gateway dev`,
      url: "http://127.0.0.1:3002/ready",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      name: "Muster web",
      command: `MUSTER_RESEARCH_TEST_MODE=true MUSTER_DEMO_MODE=true NEXT_PUBLIC_MUSTER_DEMO_MODE=true MUSTER_AGENT_GATEWAY_TOKEN=0707070707070707070707070707070707070707070707070707070707070707 CONNECTOR_ENCRYPTION_KEY=0707070707070707070707070707070707070707070707070707070707070707 BETTER_AUTH_SECRET=muster-playwright-secret-at-least-32-characters AUTH_RATE_LIMIT_MAX=10000 DATABASE_URL=${testDatabaseUrl} REDIS_URL=${testRedisUrl} AGENT_GATEWAY_URL=http://127.0.0.1:3002 pnpm --dir apps/web dev`,
      url: "http://127.0.0.1:3000/api/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});
