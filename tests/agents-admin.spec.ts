import { expect, test } from "@playwright/test";
import { database, schema } from "@muster/database";
import { eq } from "drizzle-orm";

type ApiData<T> = { data: T };

async function requireAgentByName(name: "Alfie" | "Jessie" | "Parker") {
  const [definition] = await database()
    .select({
      id: schema.agentDefinitions.id,
      organisationId: schema.agentDefinitions.organisationId,
      name: schema.agentDefinitions.name,
    })
    .from(schema.agentDefinitions)
    .where(eq(schema.agentDefinitions.name, name))
    .limit(1);
  if (!definition) throw new Error(`Seeded ${name} agent required`);
  return definition;
}

test("Agent directory lists Alfie, Jessie, and Parker as distinct governed agents", async ({
  page,
}) => {
  await page.goto("/agents");
  await expect(
    page.getByRole("heading", { name: "Agent directory" }),
  ).toBeVisible();
  for (const name of ["Alfie", "Jessie", "Parker"] as const) {
    const card = page
      .getByRole("link")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card).toHaveCount(1);
  }
});

test("Administrators can evaluate a governed profile version from the Versions tab", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const alfie = await requireAgentByName("Alfie");

  const suffix = Date.now().toString(36);
  const proposed = await page.request.post(
    `/api/v1/agents/${alfie.id}/profile`,
    {
      data: {
        action: "propose_profile",
        proposal: {
          displayName: `Alfie governed profile ${suffix}`,
          description:
            "Synthetic browser-proposed governed profile proving evaluation before approval.",
          role: "Synthetic evidence-backed threat research agent",
          operatingInstructions:
            "Read only organisation-scoped evidence supplied by Muster. Compare identifiers and timestamps, cite every supporting record, and return uncertainty for human review. Never perform an external action.",
          communicationStyle: "Concise, evidence-linked, and cautious",
          examplePrompts: [
            "Summarise the latest threat intelligence for this room",
          ],
          changeRationale: `Browser governance test ${suffix} proposes a synthetic profile version.`,
        },
      },
    },
  );
  expect(proposed.status(), await proposed.text()).toBe(200);
  const versionId = (
    (await proposed.json()) as ApiData<{ version: { id: string } }>
  ).data.version.id;
  expect(versionId).toBeTruthy();

  await page.goto(`/agents/${alfie.id}/versions`);
  await expect(
    page.getByRole("heading", { name: "Governed agent profile versions" }),
  ).toBeVisible();
  const card = page
    .getByRole("article")
    .filter({ hasText: `Alfie governed profile ${suffix}` });
  await expect(card).toHaveCount(1);
  await expect(card.getByText("draft", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Evaluate" }).click();
  await expect(card.getByText(/\d+ \/ 100/).first()).toBeVisible();
});

test("Agent overview surfaces example prompts and availability for governed profiles", async ({
  page,
}) => {
  const alfie = await requireAgentByName("Alfie");
  await page.goto(`/agents/${alfie.id}`);
  await expect(
    page.getByRole("heading", { name: "Alfie", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Example prompts", { exact: true })).toBeVisible();
  await expect(page.getByText("Availability", { exact: true })).toBeVisible();
});
