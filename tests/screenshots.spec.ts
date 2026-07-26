import { mkdir } from "node:fs/promises";
import { test } from "@playwright/test";

const captures = [
  ["login", "/login"],
  ["workspace", "/"],
  ["room-soc-operations", "/rooms/soc-operations"],
  ["room-alerts", "/rooms/alerts"],
  ["room-incident", "/rooms/incident-KP-2026-0042"],
  ["room-agent-collaboration", "/rooms/investigation-suspicious-powershell"],
  ["direct-message", "/rooms/dm-maya-chen"],
  ["agent-direct-message", "/rooms/dm-triage-agent"],
  ["search", "/search"],
  ["settings", "/settings"],
] as const;

test("generate deterministic product screenshots", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await mkdir("screenshots", { recursive: true });
  for (const [name, route] of captures) {
    await page.goto(route);
    await page.addStyleTag({
      content: '[data-dynamic-message="true"] { display: none !important; }',
    });
    await page.screenshot({
      path: `screenshots/${name}.png`,
      fullPage: true,
      caret: "initial",
    });
  }

  for (const width of [375, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/rooms/soc-operations");
    await page.addStyleTag({
      content: '[data-dynamic-message="true"] { display: none !important; }',
    });
    await page.screenshot({
      path: `screenshots/room-dark-${width}.png`,
      fullPage: true,
      caret: "initial",
    });
    await page.getByRole("button", { name: "User menu and theme" }).click();
    await page.screenshot({
      path: `screenshots/room-light-${width}.png`,
      fullPage: true,
      caret: "initial",
    });
  }

  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/rooms/alerts");
  await page.screenshot({
    path: "screenshots/mobile-alerts-channel.png",
    fullPage: true,
    caret: "initial",
  });
});
