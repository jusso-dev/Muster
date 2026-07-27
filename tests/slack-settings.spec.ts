import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("Slack administration is protected and gives operators a safe empty state", async ({
  page,
  playwright,
  request,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL: process.env.MUSTER_BASE_URL ?? "http://127.0.0.1:3000",
    storageState: { cookies: [], origins: [] },
  });
  try {
    expect((await anonymous.get("/api/v1/slack/settings")).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }

  const settings = await request.get("/api/v1/slack/settings");
  const settingsBody = await settings.text();
  expect(settings.status(), settingsBody).toBe(200);
  expect(settingsBody).not.toContain("encryptedBotToken");

  await page.goto("/settings/slack");
  await expect(
    page.getByRole("heading", { name: "Slack agent harness" }),
  ).toBeVisible();
  await expect(
    page.getByText("No Slack workspace is connected."),
  ).toBeVisible();
  await expect(
    page.getByText("No Slack identities are mapped yet."),
  ).toBeVisible();
  await expect(
    page.getByText("No agents are exposed to Slack yet."),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
