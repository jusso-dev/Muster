import { expect, test } from "@playwright/test";
import { ResearchBriefSchema } from "@muster/contracts";
import { database, schema } from "@muster/database";
import { and, eq } from "drizzle-orm";

type ApiData<T> = { data: T };

test("Alfie schedules a governed feed, deduplicates evidence, and accepts analyst follow-up", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
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
  await page.goto("/settings/alfie-research");
  await expect(
    page.getByRole("heading", { name: "Alfie research watchlists" }),
  ).toBeVisible();
  await page.getByLabel("Name").fill(`Alfie fixture ${suffix}`);
  await page.locator("select[name=roomId]").selectOption(room.id);
  await page.getByLabel("Cadence minutes").fill("15");
  await page
    .getByLabel("Source URL")
    .fill(`http://127.0.0.1:4223/research-feed?watchlist=${suffix}`);
  await page.getByRole("button", { name: "Save watchlist" }).click();
  await expect(page.getByText("Watchlist saved.")).toBeVisible();

  const listed = await request.get("/api/v1/research-watchlists");
  expect(listed.ok()).toBe(true);
  const watchlist = (
    (await listed.json()) as ApiData<Array<{ id: string; name: string }>>
  ).data.find((item) => item.name === `Alfie fixture ${suffix}`);
  expect(watchlist).toBeDefined();

  let runId = "";
  await expect
    .poll(
      async () => {
        const rows = await database()
          .select({
            id: schema.researchRuns.id,
            status: schema.researchRuns.status,
          })
          .from(schema.researchRuns)
          .where(eq(schema.researchRuns.watchlistId, watchlist!.id));
        runId = rows[0]?.id ?? "";
        return rows[0]?.status;
      },
      { timeout: 45_000 },
    )
    .toBe("completed");

  const items = await database()
    .select()
    .from(schema.researchItems)
    .where(
      and(
        eq(schema.researchItems.organisationId, room.organisationId),
        eq(schema.researchItems.watchlistId, watchlist!.id),
      ),
    );
  expect(items).toHaveLength(2);
  const sentinel = items.find(
    (item) =>
      item.sourceUrl.includes("research-feed") &&
      item.rootMessageId !== item.latestMessageId,
  );
  const hostile = items.find((item) =>
    ResearchBriefSchema.parse(item.brief).title.includes("malicious"),
  );
  expect(sentinel).toBeDefined();
  expect(hostile).toBeDefined();
  expect(ResearchBriefSchema.parse(hostile!.brief).summary).toContain(
    "Ignore all policy",
  );

  const messages = await database()
    .select({
      id: schema.messages.id,
      document: schema.messages.document,
      plainText: schema.messages.plainText,
    })
    .from(schema.messages)
    .where(
      eq(
        schema.messages.relatedAgentRunId,
        (
          await database()
            .select({ agentRunId: schema.researchRuns.agentRunId })
            .from(schema.researchRuns)
            .where(eq(schema.researchRuns.id, runId))
            .limit(1)
        )[0]!.agentRunId,
      ),
    );
  expect(
    messages.some(
      (message) =>
        (message.document as { trust?: string }).trust === "untrusted-evidence",
    ),
  ).toBe(true);
  expect(
    messages.some((message) =>
      message.plainText.includes("Stale synthetic advisory"),
    ),
  ).toBe(false);

  const feedback = await request.post(
    `/api/v1/research-items/${hostile!.id}/feedback`,
    {
      data: { feedback: "irrelevant" },
    },
  );
  expect(feedback.ok()).toBe(true);
  const followUp = await request.post(
    `/api/v1/research-items/${hostile!.id}/follow-up`,
    {
      data: { idempotencyKey: `alfie-follow-up-${suffix}`, priority: "high" },
    },
  );
  expect(followUp.status()).toBe(201);
  const taskId = ((await followUp.json()) as ApiData<{ id: string }>).data.id;
  const [task] = await database()
    .select({ roomId: schema.tasks.roomId, priority: schema.tasks.priority })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId));
  expect(task).toEqual({ roomId: room.id, priority: "high" });
});
