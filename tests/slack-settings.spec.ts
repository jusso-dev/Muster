import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

type SyntheticSettings = {
  installations: Array<Record<string, unknown>>;
  actors: Array<{ id: string; displayName: string }>;
  agents: Array<{ id: string; name: string }>;
  identities: Array<Record<string, unknown>>;
  exposures: Array<Record<string, unknown>>;
  deliveries: Array<Record<string, unknown>>;
  encryptedBotToken?: string;
  encryptedPayload?: string;
};

async function syntheticSettings(request: APIRequestContext) {
  const response = await request.get("/api/v1/slack/settings");
  const body = (await response.json()) as {
    data: {
      actors: SyntheticSettings["actors"];
      agents: SyntheticSettings["agents"];
    };
  };
  expect(response.status()).toBe(200);
  expect(body.data.actors.length).toBeGreaterThan(0);
  expect(body.data.agents.length).toBeGreaterThan(0);
  return {
    installations: [
      {
        id: "00000000-0000-4000-8000-000000000101",
        teamId: "T-SYNTHETIC",
        teamName: "Synthetic Security Workspace",
        scopes: [
          "app_mentions:read",
          "assistant:write",
          "chat:write",
          "commands",
          "im:history",
        ],
        status: "active",
        installedAt: "2026-07-27T01:00:00.000Z",
        lastHealthAt: null,
        lastDeliveryAt: "2026-07-27T01:05:00.000Z",
        lastError: null,
      },
    ],
    actors: body.data.actors,
    agents: body.data.agents,
    identities: [],
    exposures: [],
    deliveries: [
      {
        id: "00000000-0000-4000-8000-000000000102",
        installationId: "00000000-0000-4000-8000-000000000101",
        runId: "00000000-0000-4000-8000-000000000103",
        status: "dead_letter",
        attemptCount: 3,
        lastError: "Slack chat.update failed: synthetic_channel_not_found",
        updatedAt: "2026-07-27T01:10:00.000Z",
      },
    ],
    // Deliberately present in the fake API response. The UI must ignore both.
    encryptedBotToken: "xoxb-synthetic-never-render",
    encryptedPayload: "synthetic-payload-never-render",
  } satisfies SyntheticSettings;
}

async function mockSlackAdministration(
  page: Page,
  settings: SyntheticSettings,
) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  await page.route("**/api/v1/slack/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postDataJSON?.() ?? null;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname.endsWith("/settings")) {
      await route.fulfill({ status: 200, json: { data: settings } });
      return;
    }
    if (url.pathname.endsWith("/health")) {
      settings.installations[0] = {
        ...settings.installations[0],
        lastHealthAt: "2026-07-27T01:15:00.000Z",
      };
      await route.fulfill({ status: 200, json: { data: { ok: true } } });
      return;
    }
    if (url.pathname.endsWith("/install") && method === "GET") {
      await route.fulfill({
        status: 200,
        json: {
          data: {
            authorizationUrl: `${url.origin}/settings/slack?oauth=synthetic`,
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith("/install") && method === "DELETE") {
      settings.installations[0] = {
        ...settings.installations[0],
        status: "revoked",
      };
      await route.fulfill({ status: 200, json: { data: { revoked: true } } });
      return;
    }
    if (url.pathname.endsWith("/identities") && method === "POST") {
      const input = body as {
        installationId: string;
        slackUserId: string;
        actorId: string;
      };
      const actor = settings.actors.find(
        (candidate) => candidate.id === input.actorId,
      )!;
      settings.identities = [
        {
          id: "00000000-0000-4000-8000-000000000104",
          ...input,
          actorName: actor.displayName,
          status: "active",
          createdAt: "2026-07-27T01:20:00.000Z",
        },
      ];
      await route.fulfill({ status: 200, json: { data: { saved: true } } });
      return;
    }
    if (url.pathname.endsWith("/exposures") && method === "PUT") {
      const input = body as Record<string, unknown>;
      const agent = settings.agents.find(
        (candidate) => candidate.id === input.agentId,
      )!;
      settings.exposures = [
        {
          id: "00000000-0000-4000-8000-000000000105",
          ...input,
          agentName: agent.name,
          updatedAt: "2026-07-27T01:25:00.000Z",
        },
      ];
      await route.fulfill({ status: 200, json: { data: { saved: true } } });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: "Synthetic route" } });
  });
  return calls;
}

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
  expect(settingsBody).not.toContain("encryptedPayload");

  await page.route("**/api/v1/slack/install", async (route) => {
    const origin = new URL(route.request().url()).origin;
    await route.fulfill({
      status: 200,
      json: {
        data: {
          authorizationUrl: `${origin}/settings/slack?oauth=synthetic-install`,
        },
      },
    });
  });
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
  await expect(
    page.getByText("Connect an active Slack workspace before mapping users."),
  ).toBeVisible();
  await expect(
    page.getByText("Connect an active Slack workspace before exposing agents."),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "Connect Slack" }).click();
  await expect(page).toHaveURL(/oauth=synthetic-install/);
});

test("Slack operators can refresh, map, expose, reconnect, revoke, and reach the kill switch", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const settings = await syntheticSettings(request);
  const calls = await mockSlackAdministration(page, settings);
  await page.goto("/settings/slack");

  const refresh = page.getByRole("button", { name: "Refresh diagnostics" });
  await refresh.focus();
  await expect(refresh).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Reconnect Slack" }),
  ).toBeFocused();

  await refresh.click();
  await expect(page.getByRole("status")).toContainText(
    "Slack diagnostics refreshed.",
  );
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: "Synthetic Security Workspace" })
      .getByText(/Health:/),
  ).toContainText("2026");

  const identityForm = page.locator('form[aria-label="Map a Slack user"]');
  await expect(identityForm).toHaveCount(1);
  await identityForm
    .locator('select[name="installationId"]')
    .selectOption("00000000-0000-4000-8000-000000000101");
  await identityForm.locator('input[name="slackUserId"]').fill("U-SYNTHETIC");
  await identityForm
    .locator('select[name="actorId"]')
    .selectOption(settings.actors[0]!.id);
  await identityForm
    .getByRole("button", { name: "Save identity mapping" })
    .click();
  await expect(page.getByText(/U-SYNTHETIC.*→/)).toBeVisible();

  const exposureForm = page.locator('form[aria-label="Agent exposure policy"]');
  await expect(exposureForm).toHaveCount(1);
  await exposureForm
    .locator('select[name="installationId"]')
    .selectOption("00000000-0000-4000-8000-000000000101");
  await exposureForm
    .locator('select[name="agentId"]')
    .selectOption(settings.agents[0]!.id);
  await exposureForm
    .locator('textarea[name="allowedChannelIds"]')
    .fill("C-TRIAGE, C-REVIEW");
  const enabled = exposureForm.locator('input[name="enabled"]');
  const defaultAgent = exposureForm.locator('input[name="isDefault"]');
  await enabled.uncheck();
  await expect(defaultAgent).toBeDisabled();
  await expect(defaultAgent).not.toBeChecked();
  await enabled.check();
  await defaultAgent.check();
  await exposureForm
    .getByRole("button", { name: "Save exposure policy" })
    .click();
  await expect(
    page.getByLabel("Configured Slack agent exposures"),
  ).toContainText("default");
  await expect(
    page.getByLabel("Configured Slack agent exposures"),
  ).toContainText("C-TRIAGE, C-REVIEW");

  await expect(page.getByText("dead_letter", { exact: true })).toBeVisible();
  await expect(
    page.getByText("synthetic_channel_not_found", { exact: false }),
  ).toBeVisible();
  const pageText = await page.locator("body").innerText();
  expect(pageText).not.toContain("xoxb-synthetic-never-render");
  expect(pageText).not.toContain("synthetic-payload-never-render");
  expect(pageText).not.toContain("encryptedBotToken");
  expect(pageText).not.toContain("encryptedPayload");

  const revokeTrigger = page.getByRole("button", { name: "Revoke" });
  await revokeTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Revoke Slack workspace?" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Revoke workspace" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  const dialogAxe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(dialogAxe.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(revokeTrigger).toBeFocused();

  await page.getByRole("button", { name: "Reconnect Slack" }).click();
  await expect(page).toHaveURL(/oauth=synthetic/);
  await page.goto("/settings/slack");
  await page.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("button", { name: "Revoke workspace" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Slack installation revoked.",
  );
  await expect(
    page.getByRole("button", { name: "Connect Slack" }),
  ).toBeFocused();

  const settingsCalls = calls.filter((call) => call.path.endsWith("/settings"));
  expect(settingsCalls.length).toBeGreaterThanOrEqual(4);
  expect(calls.some((call) => call.path.endsWith("/health"))).toBe(true);
  expect(
    calls.some(
      (call) => call.method === "POST" && call.path.endsWith("/identities"),
    ),
  ).toBe(true);
  expect(
    calls.some(
      (call) => call.method === "PUT" && call.path.endsWith("/exposures"),
    ),
  ).toBe(true);
  expect(
    calls.some(
      (call) => call.method === "DELETE" && call.path.endsWith("/install"),
    ),
  ).toBe(true);

  await page.getByRole("link", { name: "kill switch" }).click();
  const restore = page.getByRole("button", { name: "Restore agent" });
  if (await restore.isVisible()) await restore.click();
  await page.getByRole("button", { name: "Kill switch" }).click();
  try {
    await expect(restore).toBeVisible();
  } finally {
    if (await restore.isVisible()) await restore.click();
  }
  await expect(page.getByRole("button", { name: "Kill switch" })).toBeVisible();
});

test("Slack administration exposes stable loading and retryable error states", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  let attempts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/slack/settings", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await gate;
      await route.fulfill({
        status: 503,
        json: { detail: "Synthetic Slack diagnostics are unavailable." },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        data: {
          installations: [],
          actors: [],
          agents: [],
          identities: [],
          exposures: [],
          deliveries: [],
        },
      },
    });
  });
  const navigation = page.goto("/settings/slack");
  await expect(page.getByRole("status")).toContainText(
    "Loading Slack administration",
  );
  release();
  await navigation;
  const errorAlert = page
    .getByRole("alert")
    .filter({ hasText: "Synthetic Slack diagnostics are unavailable." });
  await expect(errorAlert).toContainText(
    "Synthetic Slack diagnostics are unavailable.",
  );
  await page.getByRole("button", { name: "Retry loading" }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace connections" }),
  ).toBeVisible();
  await expect(errorAlert).toBeHidden();
});

test("Slack administration reflows for mobile and 200 percent zoom without overflow", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const settings = await syntheticSettings(request);
  await mockSlackAdministration(page, settings);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/settings/slack");
    await expect(
      page.getByRole("heading", { name: "Slack agent harness" }),
    ).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, `${width}px viewport`).toBeLessThanOrEqual(
      dimensions.clientWidth,
    );
  }

  const accessibility = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
