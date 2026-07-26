import { expect, type Page } from "@playwright/test";

export async function login(page: Page) {
  const email = `playwright.${Date.now()}.${Math.random().toString(36).slice(2)}@example.invalid`;
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    data: {
      name: "Playwright Administrator",
      email,
      password: "MusterTest!2026",
    },
  });
  if (!signUp.ok()) {
    throw new Error(`Playwright account creation failed (${signUp.status()})`);
  }
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("MusterTest!2026");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/rooms\/soc-operations$/);
  await expect(page.getByRole("heading", { name: "soc-operations" })).toBeVisible();
}
