import { request as playwrightRequest, expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { database, newId, schema } from "@muster/database";
import { count, eq } from "drizzle-orm";

test("two authenticated sessions complete the durable room lifecycle", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Playwright baseURL required");

  const [room] = await database()
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, "investigation-suspicious-powershell"))
    .limit(1);
  if (!room) throw new Error("Synthetic investigation room required");

  const firstContext = await browser.newContext({
    baseURL,
    storageState: ".playwright/auth.json",
  });
  const secondEmail = `room.reader.${newId()}@example.invalid`;
  const secondPassword = "MusterTest!2026";
  const secondApi = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { origin: baseURL },
  });
  const signup = await secondApi.post("/api/auth/sign-up/email", {
    data: {
      name: "Synthetic Room Reader",
      email: secondEmail,
      password: secondPassword,
    },
  });
  expect(signup.ok(), `signup returned ${signup.status()}`).toBe(true);
  const secondStorageState = await secondApi.storageState();
  await secondApi.dispose();
  const secondContext = await browser.newContext({
    baseURL,
    storageState: secondStorageState,
  });
  const secondActorId = newId();
  await database()
    .insert(schema.actors)
    .values({
      id: secondActorId,
      organisationId: room.organisationId,
      actorType: "human",
      displayName: "Synthetic Room Reader",
      identityReference: secondEmail,
      capabilityAssignments: ["rooms.read", "messages.create"],
    });
  await database().insert(schema.roomMemberships).values({
    organisationId: room.organisationId,
    roomId: room.id,
    actorId: secondActorId,
    membershipRole: "member",
  });

  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await Promise.all([
      first.goto("/rooms/investigation-suspicious-powershell"),
      second.goto("/rooms/investigation-suspicious-powershell"),
    ]);
    await Promise.all([
      expect(first.getByText("Live", { exact: true })).toBeVisible(),
      expect(second.getByText("Live", { exact: true })).toBeVisible(),
    ]);

    const message = `Synthetic two-session message ${Date.now()}`;
    const firstComposer = first.locator(".tiptap");
    await firstComposer.fill(message);
    await expect(second.getByTestId("typing-indicator")).toBeVisible();
    await first.keyboard.press("Shift+Enter");
    await first.keyboard.type("Second line");
    await first.keyboard.press("Enter");
    await expect(firstComposer).toBeEmpty();
    await expect(second.getByText(message).last()).toBeVisible();
    await expect(
      second.getByRole("separator", { name: "New messages" }),
    ).toBeVisible();

    await second.reload();
    await expect(second.getByText(message).last()).toBeVisible();
    const secondMessage = second
      .getByRole("article")
      .filter({ hasText: message });
    await secondMessage.getByRole("button", { name: "Add reaction" }).click();
    await second
      .getByRole("menu", { name: "Reactions" })
      .getByRole("menuitem", { name: "Reviewing" })
      .click();
    await expect(
      first.getByRole("button", { name: /Reviewing, 1/ }).last(),
    ).toBeVisible();

    const firstMessage = first
      .getByRole("article")
      .filter({ hasText: message });
    await firstMessage.getByRole("button", { name: "Open thread" }).click();
    await expect(first).toHaveURL(/thread=/);
    await secondMessage.getByRole("button", { name: "Open thread" }).click();
    const reply = `Synthetic live thread reply ${Date.now()}`;
    await second.getByLabel("Reply to thread").fill(reply);
    await second.keyboard.press("Enter");
    await expect(first.getByText(reply)).toBeVisible();
    await first.reload();
    await expect(first).toHaveURL(/thread=/);
    await expect(first.getByText(reply)).toBeVisible();
    await first.goBack();
    await expect(first).not.toHaveURL(/thread=/);
    await first.goForward();
    await expect(first).toHaveURL(/thread=/);
    await first.getByRole("button", { name: "Close thread" }).click();
    const notifications = first.getByLabel("Notifications", { exact: true });
    await notifications.selectOption("mentions");
    await first.reload();
    await expect(
      first.getByLabel("Notifications", { exact: true }),
    ).toHaveValue("mentions");

    const lifecycleMessage = first
      .getByRole("article")
      .filter({ hasText: message });
    await lifecycleMessage
      .getByRole("button", { name: "More message actions" })
      .click();
    await first
      .getByRole("menu", { name: "Message actions" })
      .getByRole("menuitem", { name: "Save message" })
      .click();
    await lifecycleMessage
      .getByRole("button", { name: "More message actions" })
      .click();
    await first
      .getByRole("menu", { name: "Message actions" })
      .getByRole("menuitem", { name: "Pin to room" })
      .click();
    await expect(lifecycleMessage.getByText("Pinned")).toBeVisible();

    await lifecycleMessage
      .getByRole("button", { name: "More message actions" })
      .click();
    await first
      .getByRole("menu", { name: "Message actions" })
      .getByRole("menuitem", { name: "Edit" })
      .click();
    const edited = `Edited synthetic two-session message ${Date.now()}`;
    await first.getByLabel("Edit message").fill(edited);
    await first.getByRole("button", { name: "Save changes" }).click();
    await expect(
      second.locator("#room-timeline").getByText(edited).last(),
    ).toBeVisible();

    const idempotencyKey = `browser-duplicate-${newId()}`;
    const duplicateBody = {
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Synthetic duplicate-safe post" }],
          },
        ],
      },
      plainText: "Synthetic duplicate-safe post",
      messageType: "text",
      dataClassification: "internal",
      idempotencyKey,
    };
    const [duplicateOne, duplicateTwo] = await Promise.all([
      first.request.post(`/api/v1/rooms/${room.id}/messages`, {
        data: duplicateBody,
      }),
      first.request.post(`/api/v1/rooms/${room.id}/messages`, {
        data: duplicateBody,
      }),
    ]);
    expect([duplicateOne.status(), duplicateTwo.status()].sort()).toEqual([
      200, 201,
    ]);
    expect((await duplicateOne.json()).data.id).toBe(
      (await duplicateTwo.json()).data.id,
    );

    const unsafe = await first.request.post(
      `/api/v1/rooms/${room.id}/messages`,
      {
        data: {
          ...duplicateBody,
          idempotencyKey: `unsafe-${newId()}`,
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "unsafe",
                    marks: [
                      {
                        type: "link",
                        attrs: { href: "javascript:alert(1)" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    );
    expect(unsafe.status()).toBe(400);

    const structuredText = `Synthetic structured alert ${Date.now()}`;
    const structured = await first.request.post(
      `/api/v1/rooms/${room.id}/messages`,
      {
        data: {
          ...duplicateBody,
          plainText: structuredText,
          messageType: "alert",
          idempotencyKey: `structured-${newId()}`,
        },
      },
    );
    expect(structured.status()).toBe(201);
    const structuredCard = first
      .getByRole("article")
      .filter({ hasText: structuredText });
    await expect(
      structuredCard.getByText("Security alert", { exact: true }).first(),
    ).toBeVisible();
    await structuredCard.getByText("Record details").click();
    await expect(structuredCard.getByText("internal")).toBeVisible();

    const unauthenticated = await playwrightRequest.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { cookie: "" },
    });
    expect(
      (await unauthenticated.get(`/api/v1/rooms/${room.id}/messages`)).status(),
    ).toBe(401);
    await unauthenticated.dispose();

    const accessibility = await new AxeBuilder({ page: first })
      .include("#room-timeline")
      .analyze();
    expect(accessibility.violations).toEqual([]);
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("failed sends retry with the original idempotency key", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await page.goto("/rooms/investigation-suspicious-powershell");
  const message = `Synthetic recoverable send ${Date.now()}`;
  let failedIdempotencyKey: string | undefined;
  const messagesEndpoint = "**/api/v1/rooms/*/messages";
  await page.route(messagesEndpoint, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    failedIdempotencyKey = (
      route.request().postDataJSON() as { idempotencyKey: string }
    ).idempotencyKey;
    await route.abort("failed");
  });
  const composer = page.locator(".tiptap");
  await composer.fill(message);
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Message failed. Draft preserved." }),
  ).toBeVisible();
  await expect(composer).toContainText(message);
  await page.unroute(messagesEndpoint);

  const retryRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/api/v1/rooms/") &&
      request.url().endsWith("/messages"),
  );
  await page.getByRole("button", { name: "Retry" }).click();
  const retriedIdempotencyKey = (
    (await retryRequest).postDataJSON() as { idempotencyKey: string }
  ).idempotencyKey;
  expect(retriedIdempotencyKey).toBe(failedIdempotencyKey);
  await expect(page.getByText(message).last()).toBeVisible();
  const [persisted] = await database()
    .select({ value: count() })
    .from(schema.messages)
    .where(eq(schema.messages.idempotencyKey, retriedIdempotencyKey))
    .limit(1);
  expect(persisted?.value).toBe(1);
});

test("mobile composer requires the explicit send button", async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile || testInfo.project.name !== "mobile");
  await page.goto("/rooms/investigation-suspicious-powershell");
  const message = `Synthetic mobile explicit send ${Date.now()}`;
  const composer = page.locator(".tiptap");
  await composer.fill(message);
  await page.keyboard.press("Enter");
  await expect(composer).toContainText(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toBeEmpty();
  await expect(page.getByText(message).last()).toBeVisible();
});
