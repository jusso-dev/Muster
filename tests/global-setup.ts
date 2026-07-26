import { mkdir } from "node:fs/promises";
import { request, type FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    config.projects[0]?.use.baseURL?.toString() ??
    process.env.MUSTER_BASE_URL ??
    "http://127.0.0.1:3000";
  const api = await request.newContext({ baseURL });
  const response = await api.post("/api/auth/sign-in/email", {
    data: {
      email: "justin.middler@yuma.example",
      password: "MusterDemo!2026",
    },
  });
  if (!response.ok()) {
    throw new Error(`Playwright authentication failed (${response.status()})`);
  }

  await mkdir(".playwright", { recursive: true });
  await api.storageState({ path: ".playwright/auth.json" });
  await api.dispose();
}
