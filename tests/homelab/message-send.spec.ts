import { expect, test, type Page, type TestInfo } from "@playwright/test";

type MessageDiagnostic = {
  status: number;
  traceId: string | null;
  problem: string | null;
};

function collectSanitisedDiagnostics(page: Page, testInfo: TestInfo) {
  const consoleErrors: string[] = [];
  const messageResponses: MessageDiagnostic[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text().slice(0, 500));
    }
  });
  page.on("response", async (response) => {
    if (
      response.request().method() !== "POST" ||
      !response.url().includes("/api/v1/rooms/") ||
      !response.url().endsWith("/messages")
    ) {
      return;
    }
    const body = (await response.json().catch(() => null)) as {
      traceId?: unknown;
      detail?: unknown;
      title?: unknown;
    } | null;
    messageResponses.push({
      status: response.status(),
      traceId: typeof body?.traceId === "string" ? body.traceId : null,
      problem:
        typeof body?.detail === "string"
          ? body.detail.slice(0, 500)
          : typeof body?.title === "string"
            ? body.title.slice(0, 500)
            : null,
    });
  });

  return async () => {
    await testInfo.attach("sanitised-diagnostics", {
      body: JSON.stringify({ consoleErrors, messageResponses }, null, 2),
      contentType: "application/json",
    });
  };
}

test("deployed user can send and reload a durable room message", async ({
  page,
}, testInfo) => {
  const attachDiagnostics = collectSanitisedDiagnostics(page, testInfo);
  const message = `Synthetic homelab message ${testInfo.project.name} ${Date.now()}`;

  try {
    await page.goto("/rooms/investigation-suspicious-powershell");
    await expect(
      page.getByRole("heading", {
        name: "investigation-suspicious-powershell",
      }),
    ).toBeVisible();

    const composer = page.locator(".tiptap");
    await composer.fill(message);
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(composer).toBeEmpty();
    await expect(page.getByText(message).last()).toBeVisible();
    await page.reload();
    await expect(page.getByText(message).last()).toBeVisible();
  } finally {
    await attachDiagnostics();
  }
});

test("deployed user uploads governed evidence and reloads its message", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const attachDiagnostics = collectSanitisedDiagnostics(page, testInfo);
  const suffix = `${Date.now()}`;
  const fileName = `synthetic-homelab-evidence-${suffix}.txt`;
  const message = `Synthetic homelab evidence ${suffix}`;

  try {
    await page.goto("/rooms/investigation-suspicious-powershell");
    await expect(page.getByTestId("room-presence")).toHaveText("1 present");
    await page.getByLabel("Choose evidence files").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(`Synthetic homelab evidence payload ${suffix}`),
    });
    await expect(page.getByText("Stored · pending scan")).toBeVisible();
    await page.locator(".tiptap").fill(message);
    await page.getByRole("button", { name: "Send", exact: true }).click();

    const posted = page.getByRole("article").filter({ hasText: message });
    await expect(posted.getByText(fileName)).toBeVisible();
    await expect(
      posted.getByText("Stored evidence · pending scan"),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("article").filter({ hasText: message }).getByText(fileName),
    ).toBeVisible();
  } finally {
    await attachDiagnostics();
  }
});
