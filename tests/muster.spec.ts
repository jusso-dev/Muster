import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("local administrator can sign in", async ({ page }) => {
  await page.context().clearCookies();
  await login(page);
});

test("room workspace and command palette are accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/rooms\/soc-operations$/);
  await expect(page.getByRole("heading", { name: "soc-operations" })).toBeVisible();
  await page
    .getByRole("button", { name: /Search Muster Demo Workspace/ })
    .click();
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.getByPlaceholder("Type a command or search rooms").fill("open #alerts");
  await page.getByRole("button", { name: /Open #alerts/ }).click();
  await expect(page.getByRole("heading", { name: "alerts" })).toBeVisible();
});

test("room posts a durable message and receives its SSE update", async ({ page }, testInfo) => {
  await page.goto("/rooms/investigation-suspicious-powershell");
  await expect(page.getByRole("heading", { name: "investigation-suspicious-powershell" })).toBeVisible();
  const note = `Playwright message from ${testInfo.project.name} ${Date.now()}`;
  const composer = page.locator(".tiptap");
  await composer.fill(note);
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Second line preserved");
  await expect(composer).toContainText("Second line preserved");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("live-event")).toContainText("room.message.created");
  await expect(composer).toBeEmpty();
  await expect(page.getByText(note).last()).toBeVisible();
  await page.reload();
  await expect(page.getByText(note).last()).toBeVisible();
});

test("room reactions toggle and thread replies persist", async ({ page }, testInfo) => {
  await page.goto("/rooms/investigation-suspicious-powershell");
  const reaction = page.getByRole("button", { name: "Reviewing, 3" });
  await reaction.click();
  await expect(page.getByRole("button", { name: "Reviewing, 2" })).toBeVisible();
  await page.getByRole("button", { name: "Reviewing, 2" }).click();
  await expect(page.getByRole("button", { name: "Reviewing, 3" })).toBeVisible();

  const replyText = `Persistent thread reply from ${testInfo.project.name} ${Date.now()}`;
  await page.getByRole("button", { name: "3 replies" }).click();
  await page.getByLabel("Reply to thread").fill(replyText);
  await page.keyboard.press("Enter");
  await expect(page.getByText(replyText)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "3 replies" }).click();
  await expect(page.getByText(replyText)).toBeVisible();
});

test("investigation exposes hypotheses, findings, and promotion approval", async ({ page }, testInfo) => {
  await page.goto("/investigations/INV-2026-0178/hypotheses");
  await expect(page.getByText("Stolen portal credentials were used")).toBeVisible();
  await page.getByRole("link", { name: "Findings" }).click();
  await expect(page.getByText("Encoded PowerShell retrieved second-stage content")).toBeVisible();
  await page.getByRole("button", { name: /Promote to Kelpie/ }).click();
  const promotionReadiness =
    testInfo.project.name === "mobile"
      ? page.locator("#promotion-readiness")
      : page.locator(".context-panel");
  await expect(promotionReadiness.getByText("Human approval required before case creation.")).toBeVisible();
});

test("agent learning is evidence-backed and approval gated", async ({ page }) => {
  await page.goto("/agents/018f55d8-c4c7-7c3e-88ef-000000000020/learning");
  await expect(page.getByText("Governed continuous learning")).toBeVisible();
  await expect(page.getByText("Evaluation + human approval")).toBeVisible();
  await expect(page.getByText("Never self-authorised")).toBeVisible();
  await expect(page.getByRole("button", { name: /Review and publish/ })).toBeVisible();
});

test("task board creates and moves durable agent work", async ({ page }, testInfo) => {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(
    page.getByText("Threat hunt the unusual authentication alert"),
  ).toBeVisible();

  const taskTitle = `Review security signal ${testInfo.project.name} ${Date.now()}`;
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByPlaceholder("What needs doing?").fill(taskTitle);
  await page
    .getByPlaceholder("Context, constraints, and deliverable")
    .fill("Correlate the signal and return an evidence-linked review draft.");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText(taskTitle)).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/"),
    ),
    page.getByRole("button", { name: `Move ${taskTitle} right` }).click(),
  ]);

  await page.reload();
  const readyColumn = page
    .getByRole("heading", { name: "Ready" })
    .locator("xpath=ancestor::section");
  await expect(readyColumn.getByText(taskTitle)).toBeVisible();
});

test("workflow YAML editor, integrations, search, and approvals render", async ({ page }) => {
  await page.goto("/workflows/suspicious-powershell-triage");
  await expect(page.getByText("Schema valid")).toBeVisible();
  await page.goto("/integrations/bower");
  await expect(page.getByText("Heartbeat and queue state do not prove")).toBeVisible();
  await page.goto("/search");
  await expect(page.getByText("6 permission-filtered results")).toBeVisible();
  await page.goto("/approvals");
  await expect(page.getByText("Isolate endpoint WS-1042")).toBeVisible();
});

test("mobile navigation supports channel work", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible();
  await page.getByRole("link", { name: /alerts/ }).click();
  await expect(page.getByRole("heading", { name: "alerts" })).toBeVisible();
});

test("core workbench has no horizontal overflow at supported widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");

  for (const width of [320, 375, 414, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/rooms/soc-operations");
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth, `${width}px viewport`).toBeLessThanOrEqual(overflow.clientWidth);
  }
});
