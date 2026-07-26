import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("administrator configures a connector without secret projection", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const displayName = `Synthetic connector ${suffix}`;
  const connectorUrl =
    process.env.MUSTER_CONNECTOR_TEST_URL ?? "http://127.0.0.1:4123";
  const secret = `synthetic-secret-${suffix}`;
  await page.goto("/integrations/connectors");
  await expect(
    page.getByRole("heading", { name: "Governed connectors" }),
  ).toBeVisible();
  await page.getByLabel("Display name").fill(displayName);
  await page.getByLabel("Instance ID").fill(`synthetic-${suffix}`);
  await page.getByLabel("Base URL").fill(connectorUrl);
  await page.getByLabel("Bearer token (optional)").fill(secret);
  await page.getByLabel("Test mode (permits HTTP)").check();
  await page.getByLabel("Allow approved private host").check();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/connectors") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save encrypted connector" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  expect(await response.text()).not.toContain(secret);
  await expect(page.getByText(displayName)).toBeVisible();
  const projection = await page.request.get("/api/v1/connectors");
  expect(await projection.text()).not.toContain(secret);
  await page
    .getByText(displayName)
    .locator("../..")
    .getByRole("button", { name: "Test", exact: true })
    .click();
  await expect(page.getByText(/Bounded test passed/)).toBeVisible({
    timeout: 20_000,
  });

  const mdeDisplayName = `Synthetic Defender ${suffix}`;
  const mdeSecret = `synthetic-mde-secret-${suffix}`;
  await page.getByLabel("Product").selectOption("defender_endpoint");
  await page.getByLabel("Display name").fill(mdeDisplayName);
  await page.getByLabel("Instance ID").fill(`synthetic-mde-${suffix}`);
  await page.getByLabel("Base URL").fill(connectorUrl);
  await page.getByLabel("Bearer token (optional)").fill(mdeSecret);
  await page.getByLabel("Test mode (permits HTTP)").check();
  await page.getByLabel("Allow approved private host").check();
  const mdeResponsePromise = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith("/api/v1/connectors") &&
      candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save encrypted connector" }).click();
  const mdeResponse = await mdeResponsePromise;
  expect(mdeResponse.status()).toBe(201);
  expect(await mdeResponse.text()).not.toContain(mdeSecret);
  await expect(page.getByText(mdeDisplayName)).toBeVisible();
  await page
    .getByText(mdeDisplayName)
    .locator("../..")
    .getByRole("button", { name: "Test", exact: true })
    .click();
  await expect(page.getByText(/Bounded test passed/)).toBeVisible({
    timeout: 20_000,
  });

  const accessibility = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
