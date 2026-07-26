import { expect, test } from "@playwright/test";

test("fresh workspace is empty and accepts first message and task", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/rooms\/soc-operations$/);
  await expect(
    page.getByRole("heading", { name: "Start the conversation" }),
  ).toBeVisible();

  const workspace = page.locator("body");
  for (const syntheticIdentity of [
    "Jordan Blake",
    "Maya Chen",
    "Daniel Brooks",
    "Priya Nair",
    "Alex Morgan",
    "WS-1042",
    "INV-2026-0178",
  ]) {
    await expect(workspace).not.toContainText(syntheticIdentity);
  }

  const message = `First clean-install message ${Date.now()}`;
  const composer = page.locator(".tiptap");
  await composer.fill(message);
  await page.keyboard.press("Enter");
  await expect(page.getByText(message)).toBeVisible();
  await page.reload();
  await expect(page.getByText(message)).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByText("0 shown")).toBeVisible();
  const task = `First clean-install task ${Date.now()}`;
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByPlaceholder("What needs doing?").fill(task);
  await page
    .getByPlaceholder("Context, constraints, and deliverable")
    .fill("Verify real work can start without demonstration activity.");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText(task)).toBeVisible();
  await page.reload();
  await expect(page.getByText(task)).toBeVisible();
});
