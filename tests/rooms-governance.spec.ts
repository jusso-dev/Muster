import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("room browser is responsive, keyboard reachable, and accessible", async ({
  page,
}) => {
  await page.goto("/rooms");
  await expect(
    page.getByRole("heading", { name: "Rooms", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Search name, purpose or topic"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("administrator completes governed room lifecycle through the UI", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const roomName = `Synthetic Governance ${suffix}`;
  const renamedRoom = `${roomName} Renamed`;

  await page.goto("/rooms");
  await page.getByRole("button", { name: "Create room" }).click();
  const createForm = page.locator("form").filter({ hasText: "Create room" });
  await createForm.getByLabel("Name").fill(roomName);
  await createForm.getByLabel("Type").selectOption("engineering");
  await createForm.getByLabel("Visibility").selectOption("private");
  await createForm
    .getByLabel("Topic")
    .fill("Synthetic governance verification");
  await createForm
    .getByLabel("Purpose")
    .fill("Synthetic room used for enterprise governance regression coverage.");
  await createForm.getByText("Guest invites").click();
  await createForm.getByText("Agent invites").click();
  await createForm.getByText("Export").click();
  await createForm.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText(`${roomName} created`)).toBeVisible();

  const card = page.getByRole("article").filter({ hasText: roomName });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: `Star ${roomName}` }).click();
  await expect(
    card.getByRole("button", { name: `Remove ${roomName} from starred` }),
  ).toBeVisible();
  await card.getByText("Sidebar group and order").click();
  await card.getByPlaceholder("Group").fill("Synthetic response");
  await card.getByLabel("Sidebar order").fill("12");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic response" }),
  ).toBeVisible();

  await card.getByRole("link", { name: roomName }).click();
  await expect(page).toHaveURL(/\/rooms\/synthetic-governance-/);
  await expect(
    page.getByRole("heading", { name: roomName, level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Room details", exact: true }).click();
  await expect(page.getByRole("tab", { name: "About" })).toBeVisible();
  await expect(page.getByLabel("Visibility")).toHaveValue("private");
  await page.getByLabel("Name").fill(renamedRoom);
  await page
    .getByLabel("Topic")
    .fill("Synthetic governance topic updated through room details");
  await page.getByRole("button", { name: "Save room details" }).click();
  await expect(page.getByText(renamedRoom).first()).toBeVisible();

  for (const tab of [
    "Members",
    "Agents",
    "Pinned",
    "Files",
    "Workflows",
    "Integrations",
    "Audit",
  ]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  await expect(page.getByText("room.updated").first()).toBeVisible();

  await page.goto("/rooms");
  const renamedCard = page
    .getByRole("article")
    .filter({ hasText: renamedRoom });
  await renamedCard.getByRole("button", { name: "Archive" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "archive complete" }),
  ).toBeVisible();
  await expect(renamedCard).not.toBeVisible();
  await page.getByLabel("Archived").check();
  const archivedCard = page
    .getByRole("article")
    .filter({ hasText: renamedRoom });
  await expect(
    archivedCard.getByText("Archived", { exact: true }),
  ).toBeVisible();
  await archivedCard.getByRole("button", { name: "Restore" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "restore complete" }),
  ).toBeVisible();
  await expect(
    archivedCard.getByText("Archived", { exact: true }),
  ).not.toBeVisible();

  await page.goto("/rooms/admin");
  await expect(
    page.getByRole("heading", { name: "Room governance" }),
  ).toBeVisible();
  for (const tab of ["Users", "Guests", "Agents", "Ownership", "Audit"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  await page.getByRole("tab", { name: "Ownership" }).click();
  await expect(
    page.getByRole("main").getByText(renamedRoom).last(),
  ).toBeVisible();
});

test("direct room creation is duplicate-safe through the authenticated API", async ({
  request,
}) => {
  const directory = await request.get("/api/v1/directory");
  expect(directory.ok()).toBe(true);
  const directoryPayload = (await directory.json()) as {
    data: Array<{ id: string; actorType: string; status: string }>;
  };
  const participant = directoryPayload.data.find(
    (actor) => actor.status === "active" && actor.actorType === "agent",
  );
  test.skip(!participant, "Synthetic active agent required");
  const first = await request.post("/api/v1/rooms/direct", {
    data: {
      actorIds: [participant!.id],
      idempotencyKey: `playwright-direct-first:${crypto.randomUUID()}`,
    },
  });
  const second = await request.post("/api/v1/rooms/direct", {
    data: {
      actorIds: [participant!.id],
      idempotencyKey: `playwright-direct-second:${crypto.randomUUID()}`,
    },
  });
  expect([200, 201]).toContain(first.status());
  expect(second.status()).toBe(200);
  expect((await second.json()).data.id).toBe((await first.json()).data.id);
});
