import { expect, test } from "@playwright/test";
import { HuntResultSchema } from "@muster/contracts";
import { database, schema } from "@muster/database";
import { and, eq } from "drizzle-orm";

type ApiData<T> = { data: T };

const genericTemplate = {
  key: "generic.alerts.list",
  version: 1,
  displayName: "Synthetic alert evidence",
  method: "GET",
  pathTemplate: "/alerts",
  requiredCapability: "alerts.read",
  inputSchema: { type: "object", additionalProperties: false },
  outputSchema: {
    type: "object",
    required: ["records"],
    properties: { records: { type: "array" } },
  },
  recordsPath: "records",
};

test("Jessie completes an idempotent governed multi-source hunt", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const [room] = await database()
    .select({
      id: schema.rooms.id,
      organisationId: schema.rooms.organisationId,
    })
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, "soc-operations"))
    .limit(1);
  if (!room) throw new Error("Seeded SOC operations room required");

  const suffix = Date.now().toString(36);
  const configure = async (
    product: "tawny" | "generic_rest" | "kelpie",
    baseUrl: string,
    port: number,
    templates: unknown[] = [],
  ) => {
    const response = await request.post("/api/v1/connectors", {
      data: {
        product,
        instanceId: `jessie-e2e-${product}-${suffix}`,
        displayName: `Synthetic Jessie ${product} ${suffix}`,
        baseUrl,
        allowedHosts: ["127.0.0.1"],
        allowPrivateNetwork: true,
        testMode: true,
        auth: { type: "bearer", token: `synthetic-token-${port}` },
        templates,
      },
    });
    expect(response.status()).toBe(201);
    return ((await response.json()) as ApiData<{ id: string }>).data.id;
  };

  const caseSeed = await request.post("http://127.0.0.1:4011/api/v1/cases", {
    data: {
      title: `Synthetic Jessie enrichment ${suffix}`,
      summary: "Synthetic test case for governed Jessie enrichment.",
      severity: "low",
    },
  });
  expect(caseSeed.status()).toBe(201);
  const caseId = ((await caseSeed.json()) as { id: string }).id;
  const [tawnyId, genericId] = await Promise.all([
    configure("tawny", "http://127.0.0.1:4012", 4012),
    configure("generic_rest", "http://127.0.0.1:4123", 4123, [genericTemplate]),
    configure("kelpie", "http://127.0.0.1:4011", 4011),
  ]);
  const idempotencyKey = `jessie-e2e-hunt-${suffix}`;
  const huntRequest = {
    question:
      "Investigate synthetic activity for 192.0.2.44 and explain the evidence.",
    roomId: room.id,
    linkedCaseId: caseId,
    sourceIds: [tawnyId, genericId],
    maxRecordsPerSource: 50,
    trainingMode: false,
    idempotencyKey,
  };
  const first = await request.post("/api/v1/hunts", { data: huntRequest });
  expect(first.status()).toBe(202);
  const created = (
    (await first.json()) as ApiData<{
      id: string;
      agentRunId: string;
      duplicate: boolean;
      plan: { approvalRequired: boolean; queries: unknown[] };
    }>
  ).data;
  expect(created.duplicate).toBe(false);
  expect(created.plan.approvalRequired).toBe(false);
  expect(created.plan.queries).toHaveLength(2);

  const duplicate = await request.post("/api/v1/hunts", {
    data: huntRequest,
  });
  expect(duplicate.status()).toBe(200);
  expect(
    (
      (await duplicate.json()) as ApiData<{
        id: string;
        agentRunId: string;
        duplicate: boolean;
      }>
    ).data,
  ).toMatchObject({
    id: created.id,
    agentRunId: created.agentRunId,
    duplicate: true,
  });

  let completed: {
    status: string;
    result: unknown;
    queries: Array<{ status: string }>;
  } | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/v1/hunts/${created.id}`);
        expect(response.ok()).toBe(true);
        completed = (
          (await response.json()) as ApiData<{
            status: string;
            result: unknown;
            queries: Array<{ status: string }>;
          }>
        ).data;
        return completed.status;
      },
      { timeout: 45_000 },
    )
    .toBe("completed");

  expect(completed).not.toBeNull();
  expect(completed!.queries).toHaveLength(2);
  expect(
    completed!.queries.every((query) => query.status === "succeeded"),
  ).toBe(true);
  const result = HuntResultSchema.parse(completed!.result);
  expect(result.observables).toContainEqual(
    expect.objectContaining({
      type: "ip",
      normalizedValue: "192.0.2.44",
    }),
  );
  expect(result.observedFacts.length).toBeGreaterThan(0);
  expect(result.inferences.length).toBeGreaterThan(0);
  expect(result.enrichmentProposal?.caseId).toBe(caseId);

  const enrichment = await request.post(
    `/api/v1/hunts/${created.id}/enrichment`,
  );
  expect(enrichment.status()).toBe(202);
  const delivery = (
    (await enrichment.json()) as ApiData<{
      id: string;
      approvalId: string;
      status: string;
      duplicate: boolean;
    }>
  ).data;
  expect(delivery).toMatchObject({
    status: "awaiting_approval",
    duplicate: false,
  });

  const replayedEnrichment = await request.post(
    `/api/v1/hunts/${created.id}/enrichment`,
  );
  expect(replayedEnrichment.status()).toBe(202);
  expect(
    (
      (await replayedEnrichment.json()) as ApiData<{
        id: string;
        duplicate: boolean;
      }>
    ).data,
  ).toMatchObject({
    id: delivery.id,
    duplicate: true,
  });

  const approval = await request.post(
    `/api/v1/approvals/${delivery.approvalId}/decisions`,
    {
      data: {
        status: "approved",
        reason: "Synthetic Jessie enrichment reviewed for E2E proof.",
      },
    },
  );
  expect(approval.ok()).toBe(true);
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/v1/integration-actions/${delivery.id}`,
        );
        expect(response.ok()).toBe(true);
        return (
          (await response.json()) as ApiData<{
            status: string;
          }>
        ).data.status;
      },
      { timeout: 30_000 },
    )
    .toBe("succeeded");

  const caseComments = await request.get(
    `http://127.0.0.1:4011/api/v1/cases/${encodeURIComponent(caseId)}/comments`,
  );
  expect(caseComments.ok()).toBe(true);
  expect(
    ((await caseComments.json()) as { comments: unknown[] }).comments,
  ).toHaveLength(1);

  const messages = await request.get(`/api/v1/rooms/${room.id}/messages`);
  expect(messages.ok()).toBe(true);
  const roomMessages = (
    (await messages.json()) as ApiData<
      Array<{ plainText: string; document: Record<string, unknown> }>
    >
  ).data;
  expect(
    roomMessages.some((message) =>
      message.plainText.includes("Jessie prepared a bounded hunt plan"),
    ),
  ).toBe(true);
  expect(
    roomMessages.some((message) =>
      message.plainText.includes("Jessie completed the bounded hunt."),
    ),
  ).toBe(true);
  expect(
    roomMessages.filter(
      (message) => message.document.deliveryId === delivery.id,
    ),
  ).toHaveLength(1);

  const [approvalRecord, actionAudit] = await Promise.all([
    database()
      .select({ status: schema.approvals.status })
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.organisationId, room.organisationId),
          eq(schema.approvals.id, delivery.approvalId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]),
    database()
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.organisationId, room.organisationId),
          eq(schema.auditEvents.targetId, delivery.id),
        ),
      ),
  ]);
  expect(approvalRecord?.status).toBe("executed");
  expect(actionAudit.map((event) => event.action)).toEqual(
    expect.arrayContaining([
      "integration.action.approval_requested",
      "integration.action.succeeded",
    ]),
  );
});
