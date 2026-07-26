import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";

const execFile = promisify(execFileCallback);

type Room = { id: string; slug: string };
type TaskView = {
  data: Array<{
    id: string;
    title: string;
    agentRunId: string | null;
    agentRunStatus: string | null;
  }>;
  meta: {
    assignees: Array<{ id: string; actorType: string }>;
  };
};

function requirePrivateHomelab(testInfo: TestInfo) {
  test.skip(
    process.env.MUSTER_HOMELAB_CRITICAL !== "true",
    "Private homelab critical-product environment is not enabled.",
  );
  if (process.env.MUSTER_CAPTURE_ARTIFACTS !== "false") {
    throw new Error(
      "MUSTER_CAPTURE_ARTIFACTS=false is required before private credentials are used.",
    );
  }
  if (!testInfo.project.use.baseURL) {
    throw new Error("Playwright baseURL is required.");
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function secondaryStorageState(baseURL: string) {
  const api = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { origin: baseURL },
    storageState: { cookies: [], origins: [] },
  });
  const response = await api.post("/api/auth/sign-in/email", {
    data: {
      email: requiredEnvironment("MUSTER_SECONDARY_EMAIL"),
      password: requiredEnvironment("MUSTER_SECONDARY_PASSWORD"),
    },
  });
  expect(response.status()).toBe(200);
  const storageState = await api.storageState();
  await api.dispose();
  return storageState;
}

async function joinedRoom(request: APIRequestContext, slug: string) {
  const response = await request.get("/api/v1/rooms?membership=joined");
  expect(response.ok()).toBe(true);
  const room = ((await response.json()).data as Room[]).find(
    (candidate) => candidate.slug === slug,
  );
  if (!room) throw new Error(`Joined room is required: ${slug}`);
  return room;
}

function messageBody(text: string, idempotencyKey: string) {
  return {
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    },
    plainText: text,
    messageType: "text",
    dataClassification: "internal",
    idempotencyKey,
  };
}

async function createAssignedTask(
  request: APIRequestContext,
  roomId: string,
  suffix: string,
) {
  const taskViewResponse = await request.get("/api/v1/tasks");
  expect(taskViewResponse.ok()).toBe(true);
  const taskView = (await taskViewResponse.json()) as TaskView;
  const agent = taskView.meta.assignees.find(
    (candidate) => candidate.actorType === "agent",
  );
  if (!agent) throw new Error("Active synthetic task agent is required.");
  const body = {
    title: `Synthetic restart-safe task ${suffix}`,
    description:
      "Return a bounded synthetic review. Do not contact external systems.",
    status: "ready",
    priority: "normal",
    assignedActorId: agent.id,
    roomId,
    idempotencyKey: `critical-task-create:${suffix}`,
  };
  const [first, duplicate] = await Promise.all([
    request.post("/api/v1/tasks", { data: body }),
    request.post("/api/v1/tasks", { data: body }),
  ]);
  expect([first.status(), duplicate.status()].sort()).toEqual([200, 201]);
  const firstId = ((await first.json()).data as { id: string }).id;
  expect(((await duplicate.json()).data as { id: string }).id).toBe(firstId);
  return { id: firstId, title: body.title };
}

async function withAuthenticatedContexts(browser: Browser, baseURL: string) {
  const primary = await browser.newContext({
    baseURL,
    storageState: ".playwright/auth.json",
  });
  const secondary = await browser.newContext({
    baseURL,
    storageState: await secondaryStorageState(baseURL),
  });
  return { primary, secondary };
}

test("deployed user can sign out and back in", async ({ page }, testInfo) => {
  requirePrivateHomelab(testInfo);
  test.skip(testInfo.project.name !== "chromium");

  await page.goto("/rooms/soc-operations");
  await page.getByRole("button", { name: "User menu and theme" }).click();
  await page
    .getByRole("menu", { name: "User menu" })
    .getByRole("menuitem", { name: "Sign out" })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/v1/rooms")).status()).toBe(401);
  await page
    .getByLabel("Email address")
    .fill(requiredEnvironment("MUSTER_LOCAL_ADMIN_EMAIL"));
  await page
    .getByLabel("Password")
    .fill(requiredEnvironment("MUSTER_LOCAL_ADMIN_PASSWORD"));
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/rooms\/soc-operations$/);
});

test("two deployed identities complete critical collaboration work", async ({
  browser,
  baseURL,
}, testInfo) => {
  requirePrivateHomelab(testInfo);
  test.skip(testInfo.project.name !== "chromium");
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Playwright baseURL is required.");

  const { primary, secondary } = await withAuthenticatedContexts(
    browser,
    baseURL,
  );
  const first = await primary.newPage();
  const second = await secondary.newPage();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  try {
    const room = await joinedRoom(first.request, "soc-operations");
    await Promise.all([
      first.goto("/rooms/soc-operations"),
      second.goto("/rooms/soc-operations"),
    ]);
    await Promise.all([
      expect(first.getByText("Live", { exact: true })).toBeVisible(),
      expect(second.getByText("Live", { exact: true })).toBeVisible(),
    ]);
    await expect(first.getByTestId("room-presence")).toContainText("present");

    let releaseSend = () => {};
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let sentBody: ReturnType<typeof messageBody> | undefined;
    await first.route("**/api/v1/rooms/*/messages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      sentBody = route.request().postDataJSON() as ReturnType<
        typeof messageBody
      >;
      await sendGate;
      await route.continue();
    });
    const message = `Synthetic critical message ${suffix}`;
    const composer = first.locator(".tiptap");
    await composer.fill(message);
    await first.keyboard.press("Shift+Enter");
    await first.keyboard.type("Second synthetic line");
    const sendResponse = first.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/rooms/${room.id}/messages`),
    );
    await first.keyboard.press("Enter");
    await expect(
      first.locator("#room-timeline").getByText(message).last(),
    ).toBeVisible();
    releaseSend();
    expect((await sendResponse).status()).toBe(201);
    await first.unroute("**/api/v1/rooms/*/messages");
    expect(sentBody?.plainText).toContain("Second synthetic line");
    await expect(composer).toBeEmpty();

    await expect(
      second.locator("#room-timeline").getByText(message).last(),
    ).toBeVisible();
    await expect(
      second.getByRole("separator", { name: "New messages" }),
    ).toBeVisible();
    await second.reload();
    const secondMessage = second
      .getByRole("article")
      .filter({ hasText: message });
    await expect(secondMessage).toBeVisible();
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
    await secondMessage.getByRole("button", { name: "Open thread" }).click();
    const reply = `Synthetic live reply ${suffix}`;
    await second.getByLabel("Reply to thread").fill(reply);
    await second.keyboard.press("Enter");
    await expect(first.getByText(reply)).toBeVisible();
    await first.reload();
    await expect(first).toHaveURL(/thread=/);
    await expect(first.getByText(reply)).toBeVisible();
    await first.getByRole("button", { name: "Close thread" }).click();

    const duplicateText = `Synthetic duplicate message ${suffix}`;
    const duplicateBody = messageBody(
      duplicateText,
      `critical-message-duplicate:${suffix}`,
    );
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
    const duplicateId = ((await duplicateOne.json()).data as { id: string }).id;
    expect(((await duplicateTwo.json()).data as { id: string }).id).toBe(
      duplicateId,
    );

    const retryText = `Synthetic recoverable message ${suffix}`;
    let retryBody: ReturnType<typeof messageBody> | undefined;
    await first.route("**/api/v1/rooms/*/messages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      retryBody = route.request().postDataJSON() as ReturnType<
        typeof messageBody
      >;
      await route.abort("failed");
    });
    await first.locator(".tiptap").fill(retryText);
    await first.keyboard.press("Enter");
    await expect(
      first
        .getByRole("alert")
        .filter({ hasText: "Message failed. Draft preserved." }),
    ).toBeVisible();
    await first.unroute("**/api/v1/rooms/*/messages");
    const retryRequest = first.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/messages"),
    );
    await first.getByRole("button", { name: "Retry" }).click();
    const retriedRequest = await retryRequest;
    const retryRequestBody = retriedRequest.postDataJSON() as ReturnType<
      typeof messageBody
    >;
    expect((await retriedRequest.response())?.ok()).toBe(true);
    expect(retryRequestBody.idempotencyKey).toBe(retryBody?.idempotencyKey);
    await expect(first.getByText(retryText).last()).toBeVisible();

    const refreshText = `Synthetic refresh recovery ${suffix}`;
    await first.route("**/api/v1/rooms/*/messages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.abort("failed");
    });
    const refreshRequest = first.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/messages"),
    );
    await first.locator(".tiptap").fill(refreshText);
    await first.getByRole("button", { name: "Send", exact: true }).click();
    const refreshBody = (await refreshRequest).postDataJSON() as ReturnType<
      typeof messageBody
    >;
    expect(refreshBody.idempotencyKey).toBeTruthy();
    await first.reload();
    await first.unroute("**/api/v1/rooms/*/messages");
    const [refreshRetry, refreshDuplicate] = await Promise.all([
      first.request.post(`/api/v1/rooms/${room.id}/messages`, {
        data: refreshBody,
      }),
      first.request.post(`/api/v1/rooms/${room.id}/messages`, {
        data: refreshBody,
      }),
    ]);
    expect([refreshRetry.status(), refreshDuplicate.status()].sort()).toEqual([
      200, 201,
    ]);
    const refreshId = ((await refreshRetry.json()).data as { id: string }).id;
    expect(((await refreshDuplicate.json()).data as { id: string }).id).toBe(
      refreshId,
    );

    const task = await createAssignedTask(first.request, room.id, suffix);
    const delegationKey = `critical-task-delegate:${suffix}`;
    const [delegated, delegationDuplicate] = await Promise.all([
      first.request.post(`/api/v1/tasks/${task.id}/delegate`, {
        headers: { "Idempotency-Key": delegationKey },
      }),
      first.request.post(`/api/v1/tasks/${task.id}/delegate`, {
        headers: { "Idempotency-Key": delegationKey },
      }),
    ]);
    expect(delegated.status()).toBe(202);
    expect(delegationDuplicate.status()).toBe(202);
    const runId = ((await delegated.json()).data as { id: string }).id;
    expect(((await delegationDuplicate.json()).data as { id: string }).id).toBe(
      runId,
    );
    await first.request.post(`/api/v1/tasks/${task.id}/cancel`);

    await first.goto("/tasks");
    await expect(first.getByText(task.title)).toBeVisible();
    await first.goto("/search");
    await first.getByPlaceholder("Search rooms and messages").fill(message);
    await first.getByRole("button", { name: "Search", exact: true }).click();
    await expect(first.getByText(message).last()).toBeVisible();

    const foreignRoomId = process.env.MUSTER_FOREIGN_ROOM_ID;
    if (foreignRoomId) {
      expect(
        (
          await first.request.get(`/api/v1/rooms/${foreignRoomId}/messages`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await first.request.post(`/api/v1/rooms/${foreignRoomId}/messages`, {
            data: messageBody(
              "Synthetic cross-tenant denial",
              `critical-cross-tenant:${suffix}`,
            ),
          })
        ).status(),
      ).toBe(404);
    }
  } finally {
    await Promise.allSettled([primary.close(), secondary.close()]);
  }
});

test("mobile room work uses explicit send and survives reload", async ({
  page,
}, testInfo) => {
  requirePrivateHomelab(testInfo);
  test.skip(testInfo.project.name !== "mobile");

  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: /soc(?: |-)operations/i }).click();
  const message = `Synthetic mobile critical ${Date.now()}`;
  const composer = page.locator(".tiptap");
  await composer.fill(message);
  await page.keyboard.press("Enter");
  await expect(composer).toContainText(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(composer).toBeEmpty();
  await expect(page.getByText(message).last()).toBeVisible();
  await page.reload();
  await expect(page.getByText(message).last()).toBeVisible();
});

test("Redis, worker, and web interruptions recover without duplicates", async ({
  request,
}, testInfo) => {
  requirePrivateHomelab(testInfo);
  test.skip(testInfo.project.name !== "chromium");
  test.skip(
    process.env.MUSTER_RESILIENCE_TESTS !== "true",
    "Disruptive private homelab resilience checks are not enabled.",
  );
  test.setTimeout(180_000);
  const sshTarget = requiredEnvironment("MUSTER_HOMELAB_SSH_TARGET");
  const control = async (...args: string[]) => {
    await execFile("ssh", ["-o", "BatchMode=yes", sshTarget, ...args]);
  };
  const waitForHealth = async () => {
    await expect
      .poll(
        async () => {
          const response = await request
            .get("/api/v1/health", { timeout: 5_000 })
            .catch(() => null);
          return response?.status();
        },
        { timeout: 60_000 },
      )
      .toBe(200);
  };
  const waitForContainerHealth = async (container: string) => {
    await expect
      .poll(
        async () => {
          const { stdout } = await execFile("ssh", [
            "-o",
            "BatchMode=yes",
            sshTarget,
            "docker",
            "inspect",
            container,
            "--format",
            "{{.State.Status}},{{.State.Health.Status}}",
          ]);
          return stdout.trim();
        },
        { timeout: 60_000 },
      )
      .toBe("running,healthy");
  };

  const room = await joinedRoom(request, "soc-operations");
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const redisBody = messageBody(
    `Synthetic Redis recovery ${suffix}`,
    `critical-redis-recovery:${suffix}`,
  );
  let redisPaused = false;
  try {
    await control("docker", "pause", "muster-redis-1");
    redisPaused = true;
    const degraded = await request
      .post(`/api/v1/rooms/${room.id}/messages`, {
        data: redisBody,
        timeout: 5_000,
      })
      .catch(() => null);
    expect(degraded?.ok() ?? false).toBe(false);
  } finally {
    if (redisPaused) {
      await control("docker", "unpause", "muster-redis-1");
    }
  }
  await waitForHealth();
  const [redisRetry, redisDuplicate] = await Promise.all([
    request.post(`/api/v1/rooms/${room.id}/messages`, { data: redisBody }),
    request.post(`/api/v1/rooms/${room.id}/messages`, { data: redisBody }),
  ]);
  expect([redisRetry.status(), redisDuplicate.status()].sort()).toEqual([
    200, 201,
  ]);
  const messageId = ((await redisRetry.json()).data as { id: string }).id;
  expect(((await redisDuplicate.json()).data as { id: string }).id).toBe(
    messageId,
  );

  await control("docker", "restart", "muster-web-1");
  await waitForContainerHealth("muster-web-1");
  await waitForHealth();
  const afterWebRestart = await request.post(
    `/api/v1/rooms/${room.id}/messages`,
    { data: redisBody },
  );
  expect(afterWebRestart.status()).toBe(200);
  expect(((await afterWebRestart.json()).data as { id: string }).id).toBe(
    messageId,
  );

  const task = await createAssignedTask(request, room.id, `restart-${suffix}`);
  let workerStopped = false;
  try {
    await control("docker", "stop", "muster-worker-1");
    workerStopped = true;
    const delegationKey = `critical-worker-restart:${suffix}`;
    const [delegated, duplicate] = await Promise.all([
      request.post(`/api/v1/tasks/${task.id}/delegate`, {
        headers: { "Idempotency-Key": delegationKey },
      }),
      request.post(`/api/v1/tasks/${task.id}/delegate`, {
        headers: { "Idempotency-Key": delegationKey },
      }),
    ]);
    expect(delegated.status()).toBe(202);
    expect(duplicate.status()).toBe(202);
    expect(((await duplicate.json()).data as { id: string }).id).toBe(
      ((await delegated.json()).data as { id: string }).id,
    );
  } finally {
    if (workerStopped) {
      await control("docker", "start", "muster-worker-1");
    }
  }
  await waitForContainerHealth("muster-worker-1");
  await expect
    .poll(
      async () => {
        const response = await request.get("/api/v1/tasks");
        if (!response.ok()) return null;
        const tasks = ((await response.json()) as TaskView).data;
        return tasks.find((candidate) => candidate.id === task.id)?.agentRunId;
      },
      { timeout: 60_000 },
    )
    .toBeTruthy();
  await request.post(`/api/v1/tasks/${task.id}/cancel`);
});
