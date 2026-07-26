import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("administrator configures a connector without secret projection", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const displayName = `Synthetic connector ${suffix}`;
  const secret = `synthetic-secret-${suffix}`;
  await page.goto("/integrations/connectors");
  await expect(
    page.getByRole("heading", { name: "Governed connectors" }),
  ).toBeVisible();
  await page.getByLabel("Display name").fill(displayName);
  await page.getByLabel("Instance ID").fill(`synthetic-${suffix}`);
  await page.getByLabel("Base URL").fill("http://127.0.0.1:4123");
  await page.getByLabel("Bearer token (optional)").fill(secret);
  await page.getByText("Test mode (permits HTTP)").click();
  await page.getByText("Allow approved private host").click();
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
  const accessibility = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
