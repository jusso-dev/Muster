import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
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
  webServer: {
    command: "BETTER_AUTH_SECRET=muster-playwright-secret-at-least-32-characters AUTH_RATE_LIMIT_MAX=10000 DATABASE_URL=postgresql://muster:muster@localhost:5432/muster REDIS_URL=redis://localhost:6379 pnpm --dir apps/web dev",
    url: "http://127.0.0.1:3000/api/v1/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});
