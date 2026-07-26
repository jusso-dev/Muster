import { mkdir } from "node:fs/promises";
import { test } from "@playwright/test";

const captures = [
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

test("generate deterministic product screenshots", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await mkdir("screenshots", { recursive: true });
  for (const [name, route] of captures) {
    await page.goto(route);
    await page.addStyleTag({
      content: '[data-dynamic-message="true"] { display: none !important; }',
    });
    await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  }

  await page.goto("/rooms/soc-operations");
  await page.screenshot({ path: "screenshots/dark-mode-room.png", fullPage: true });
  await page.getByRole("button", { name: "User menu and theme" }).click();
  await page.screenshot({ path: "screenshots/light-mode-room.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rooms/soc-operations");
  await page.addStyleTag({
    content: '[data-dynamic-message="true"] { display: none !important; }',
  });
  await page.screenshot({ path: "screenshots/mobile-room.png", fullPage: true });
  await page.goto("/rooms/alerts");
  await page.screenshot({ path: "screenshots/mobile-alerts-channel.png", fullPage: true });
});
