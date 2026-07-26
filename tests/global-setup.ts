import { mkdir } from "node:fs/promises";
import { request, type FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    config.projects[0]?.use.baseURL?.toString() ??
    process.env.MUSTER_BASE_URL ??
    "http://127.0.0.1:3000";
  const email =
    process.env.MUSTER_LOCAL_ADMIN_EMAIL ?? "admin@muster.local";
  const password =
    process.env.MUSTER_LOCAL_ADMIN_PASSWORD ?? "MusterTest!2026";
  const api = await request.newContext({ baseURL });
  const credentials = { email, password };
  let response = await api.post("/api/auth/sign-in/email", {
    data: credentials,
  });
  if (response.status() === 401) {
    const signup = await api.post("/api/auth/sign-up/email", {
      data: { name: "Muster Administrator", ...credentials },
    });
    if (!signup.ok() && signup.status() !== 422) {
      throw new Error(`Playwright account setup failed (${signup.status()})`);
    }
    response = signup.ok()
      ? signup
      : await api.post("/api/auth/sign-in/email", { data: credentials });
  }
  if (!response.ok()) {
    throw new Error(`Playwright authentication failed (${response.status()})`);
  }

  await mkdir(".playwright", { recursive: true });
  await api.storageState({ path: ".playwright/auth.json" });
  await api.dispose();
}
