import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.MUSTER_BASE_URL;
const proxyServer = process.env.MUSTER_PROXY_SERVER;

if (!baseURL) {
  throw new Error("MUSTER_BASE_URL is required for homelab tests");
}

export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "homelab/**/*.spec.ts",
    "rooms-governance.spec.ts",
    "connectors-governance.spec.ts",
  ],
  globalSetup: "./tests/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/homelab",
  use: {
    baseURL,
    ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
    storageState: ".playwright/auth.json",
    trace:
      process.env.MUSTER_CAPTURE_ARTIFACTS === "false"
        ? "off"
        : "retain-on-failure",
    screenshot:
      process.env.MUSTER_CAPTURE_ARTIFACTS === "false"
        ? "off"
        : { mode: "only-on-failure", fullPage: true },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});
