import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

type Connector = { id: string; product: string };
type AsyncRecord = {
  id: string;
  status: string;
  result?: unknown;
  responseMetadata?: Record<string, unknown>;
};

async function configureConnector(
  request: APIRequestContext,
  input: {
    product: "tawny" | "tawny_response" | "kelpie";
    instanceId: string;
    displayName: string;
    baseUrl: string;
    token: string;
  },
) {
  const hostname = new URL(input.baseUrl).hostname;
  const { token, ...configuration } = input;
  const response = await request.post("/api/v1/connectors", {
    data: {
      ...configuration,
      allowedHosts: [hostname],
      allowPrivateNetwork: true,
      testMode: input.baseUrl.startsWith("http://"),
      auth: { type: "bearer", token },
      limits: {
        timeoutMs: 10_000,
        maxResponseBytes: 1_000_000,
        maxRecords: 1_000,
        maxPages: 10,
        requestsPerMinute: 60,
      },
    },
  });
  expect(response.status()).toBe(201);
  const text = await response.text();
  expect(text).not.toContain(token);
  return (JSON.parse(text) as { data: Connector }).data;
}

async function waitForRecord(
  request: APIRequestContext,
  path: string,
  expected = "succeeded",
) {
  let latest: AsyncRecord | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(path);
        expect(response.ok()).toBe(true);
        latest = (await response.json()).data as AsyncRecord;
        return latest.status;
      },
      { timeout: 30_000 },
    )
    .toBe(expected);
  if (!latest) throw new Error("Asynchronous record was not returned");
  return latest;
}

async function approveLatest(page: Page, actionType: string) {
  await page.goto("/approvals");
  const approval = page
    .locator("article")
    .filter({ hasText: actionType })
    .filter({ hasText: "pending" })
    .first();
  await expect(approval).toBeVisible();
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toContainText("approved");
}

test("real Tawny and Kelpie operations are governed, durable, and duplicate-safe", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  test.skip(
    process.env.MUSTER_REAL_INTEGRATIONS !== "true",
    "Real integration environment is not enabled.",
  );
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const tawnyUrl = process.env.MUSTER_TAWNY_URL ?? "http://127.0.0.1:4012";
  const kelpieUrl = process.env.MUSTER_KELPIE_URL ?? "http://127.0.0.1:4011";
  const tawnyToken =
    process.env.MUSTER_TAWNY_TOKEN ?? `synthetic-tawny-read-${suffix}`;
  const tawnyResponseToken =
    process.env.MUSTER_TAWNY_RESPONSE_TOKEN ??
    `synthetic-tawny-response-${suffix}`;
  const kelpieToken =
    process.env.MUSTER_KELPIE_TOKEN ?? `synthetic-kelpie-${suffix}`;
  const request = page.request;

  const roomsResponse = await request.get("/api/v1/rooms?membership=joined");
  expect(roomsResponse.ok()).toBe(true);
  const rooms = (await roomsResponse.json()).data as Array<{
    id: string;
    slug: string;
  }>;
  const room = rooms.find((candidate) => candidate.slug === "soc-operations");
  if (!room) throw new Error("SOC operations room is required");
  const taskResponse = await request.post("/api/v1/tasks", {
    data: {
      title: `Synthetic real connector verification ${suffix}`,
      description: "Tawny hunt and Kelpie case lifecycle evidence.",
      status: "in_progress",
      priority: "high",
      roomId: room.id,
    },
  });
  expect(taskResponse.status()).toBe(201);
  const taskId = ((await taskResponse.json()).data as { id: string }).id;

  const tawny = await configureConnector(request, {
    product: "tawny",
    instanceId: `homelab-read-${suffix}`,
    displayName: `Tawny real ${suffix}`,
    baseUrl: tawnyUrl,
    token: tawnyToken,
  });
  const tawnyResponse = await configureConnector(request, {
    product: "tawny_response",
    instanceId: `homelab-response-${suffix}`,
    displayName: `Tawny response real ${suffix}`,
    baseUrl: tawnyUrl,
    token: tawnyResponseToken,
  });
  const kelpie = await configureConnector(request, {
    product: "kelpie",
    instanceId: `homelab-kelpie-${suffix}`,
    displayName: `Kelpie real ${suffix}`,
    baseUrl: kelpieUrl,
    token: kelpieToken,
  });

  const inventoryResponse = await request.post(
    `/api/v1/connectors/${tawny.id}/queries`,
    {
      data: {
        templateKey: "tawny.inventory.list",
        input: {},
        idempotencyKey: `tawny-inventory-${suffix}`,
      },
    },
  );
  expect(inventoryResponse.status()).toBe(202);
  const inventoryId = ((await inventoryResponse.json()).data as { id: string })
    .id;
  const inventory = await waitForRecord(
    request,
    `/api/v1/connector-queries/${inventoryId}`,
  );
  const agents = inventory.result as Array<{ id: string; hostname: string }>;
  expect(agents.length).toBeGreaterThan(0);
  const syntheticAgent =
    agents.find((agent) => agent.hostname.includes("muster-synthetic")) ??
    agents.find((agent) => agent.hostname.includes("synthetic"));
  if (!syntheticAgent)
    throw new Error("A synthetic Tawny endpoint is required for safe response");

  const huntResponse = await request.post(
    `/api/v1/connectors/${tawny.id}/queries`,
    {
      data: {
        templateKey: "tawny.hunt.run",
        input: { query: 'last:"7d"', limit: 25 },
        roomId: room.id,
        taskId,
        idempotencyKey: `tawny-hunt-${suffix}`,
      },
    },
  );
  expect(huntResponse.status()).toBe(202);
  const huntId = ((await huntResponse.json()).data as { id: string }).id;
  const hunt = await waitForRecord(
    request,
    `/api/v1/connector-queries/${huntId}`,
  );
  expect((hunt.result as unknown[]).length).toBeGreaterThan(0);

  const isolateBody = {
    operation: "tawny.isolate_host",
    integrationId: tawnyResponse.id,
    agentId: syntheticAgent.id,
    reason: "Synthetic endpoint containment verification",
    roomId: room.id,
    taskId,
    idempotencyKey: `tawny-isolate-${suffix}`,
  };
  const isolateResponse = await request.post("/api/v1/integration-actions", {
    data: isolateBody,
  });
  expect(isolateResponse.status()).toBe(202);
  const isolate = (await isolateResponse.json()).data as {
    id: string;
    approvalId: string;
    status: string;
  };
  expect(isolate.status).toBe("awaiting_approval");
  await expect
    .poll(
      async () =>
        (
          (await (
            await request.get(`/api/v1/integration-actions/${isolate.id}`)
          ).json()) as { data: AsyncRecord }
        ).data.status,
    )
    .toBe("awaiting_approval");
  await approveLatest(page, "endpoint.isolate");
  const isolated = await waitForRecord(
    request,
    `/api/v1/integration-actions/${isolate.id}`,
  );
  expect(isolated.responseMetadata?.externalId).toBeTruthy();
  const isolateDuplicate = await request.post("/api/v1/integration-actions", {
    data: isolateBody,
  });
  expect(((await isolateDuplicate.json()).data as { id: string }).id).toBe(
    isolate.id,
  );

  const createCaseBody = {
    operation: "kelpie.case.create",
    integrationId: kelpie.id,
    title: `Synthetic Muster case ${suffix}`,
    summary:
      "Synthetic Tawny hunt promoted through an approved Muster workflow.",
    severity: "high",
    tlp: "amber",
    pap: "amber",
    classification: "other",
    tags: ["synthetic", "muster-e2e"],
    evidenceReferences: [`muster:query:${huntId}`],
    roomId: room.id,
    taskId,
    idempotencyKey: `kelpie-create-${suffix}`,
  };
  const createCaseResponse = await request.post("/api/v1/integration-actions", {
    data: createCaseBody,
  });
  expect(createCaseResponse.status()).toBe(202);
  const createCase = (await createCaseResponse.json()).data as {
    id: string;
    status: string;
  };
  expect(createCase.status).toBe("awaiting_approval");
  await approveLatest(page, "investigation.promote");
  const createdCase = await waitForRecord(
    request,
    `/api/v1/integration-actions/${createCase.id}`,
  );
  const caseId = createdCase.responseMetadata?.externalId;
  expect(typeof caseId).toBe("string");
  if (typeof caseId !== "string") throw new Error("Kelpie case ID missing");

  for (const action of [
    {
      operation: "kelpie.timeline.comment",
      integrationId: kelpie.id,
      caseId,
      body: "Synthetic Tawny hunt reviewed in Muster.",
      evidenceReferences: [`muster:query:${huntId}`],
      roomId: room.id,
      taskId,
      idempotencyKey: `kelpie-comment-${suffix}`,
    },
    {
      operation: "kelpie.observable.add",
      integrationId: kelpie.id,
      caseId,
      observableType: "ip",
      value: "203.0.113.99",
      tlp: "amber",
      description: "RFC 5737 synthetic verification indicator",
      isIoc: true,
      tags: ["synthetic"],
      roomId: room.id,
      taskId,
      idempotencyKey: `kelpie-observable-${suffix}`,
    },
    {
      operation: "kelpie.case.update",
      integrationId: kelpie.id,
      caseId,
      status: "contained",
      summary: "Synthetic case updated by governed Muster delivery.",
      roomId: room.id,
      taskId,
      idempotencyKey: `kelpie-update-${suffix}`,
    },
  ]) {
    const response = await request.post("/api/v1/integration-actions", {
      data: action,
    });
    expect(response.status()).toBe(202);
    const actionId = ((await response.json()).data as { id: string }).id;
    await waitForRecord(request, `/api/v1/integration-actions/${actionId}`);
  }

  const caseQueryResponse = await request.post(
    `/api/v1/connectors/${kelpie.id}/queries`,
    {
      data: {
        templateKey: "kelpie.case.get",
        input: { caseId },
        idempotencyKey: `kelpie-get-${suffix}`,
      },
    },
  );
  expect(caseQueryResponse.status()).toBe(202);
  const caseQueryId = ((await caseQueryResponse.json()).data as { id: string })
    .id;
  const caseQuery = await waitForRecord(
    request,
    `/api/v1/connector-queries/${caseQueryId}`,
  );
  const realCase = caseQuery.result as {
    status: string;
    observables: unknown[];
    recent_timeline: unknown[];
  };
  expect(realCase.status).toBe("contained");
  expect(realCase.observables.length).toBeGreaterThan(0);
  expect(realCase.recent_timeline.length).toBeGreaterThan(0);

  await page.goto("/rooms/soc-operations");
  await expect(
    page.getByText(new RegExp(`Tawny real ${suffix}`)),
  ).toBeVisible();
  await expect(
    page.getByText(new RegExp(`Kelpie real ${suffix}`)).first(),
  ).toBeVisible();

  if (process.env.MUSTER_AUTH_REQUIRED === "true") {
    const unauthenticated = await page.context().browser()?.newContext();
    if (!unauthenticated) throw new Error("Browser context unavailable");
    const denied = await unauthenticated.request.get(
      `${testInfo.project.use.baseURL}/api/v1/integration-actions/${isolate.id}`,
    );
    expect(denied.status()).toBe(401);
    await unauthenticated.close();
  }
});
