import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { database, newId, schema } from "@muster/database";
import { and, eq, inArray } from "drizzle-orm";
import { login } from "./helpers";

test("local administrator can sign in", async ({ page }) => {
  await page.context().clearCookies();
  await login(page);
});

test("product branding and PWA icon metadata are consistent", async ({
  page,
}) => {
  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  expect((await manifestResponse.json()).icons).toEqual([
    {
      src: "/icons/muster-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/muster-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
  ]);
  for (const size of [16, 32, 48, 96, 180, 192, 512]) {
    const iconResponse = await page.request.get(`/icons/muster-${size}.png`);
    expect(iconResponse.ok(), `${size}px icon`).toBe(true);
    expect(iconResponse.headers()["content-type"]).toContain("image/png");
  }

  await page.goto("/login");
  await expect(
    page
      .getByRole("img", { name: "Muster shield and tree logo" })
      .filter({ visible: true }),
  ).toBeVisible();
  const iconLinks = await page
    .locator('link[rel="icon"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(iconLinks).toEqual(
    expect.arrayContaining([
      "/icons/muster-16.png",
      "/icons/muster-32.png",
      "/icons/muster-48.png",
      "/icons/muster-96.png",
    ]),
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/muster-180.png",
  );
  await page.goto("/offline");
  await expect(
    page.getByRole("img", { name: "Muster shield and tree logo" }),
  ).toBeVisible();
  await page.goto("/rooms/soc-operations");
  await expect(
    page.locator('img[src*="muster-32.png"]').first(),
  ).toBeAttached();
});

test("room workspace and command palette are accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/rooms\/soc-operations$/);
  await expect(
    page.getByRole("heading", { name: "soc-operations" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Search Muster Demo Workspace/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();
  await page
    .getByPlaceholder("Type a command or search rooms")
    .fill("open #alerts");
  await page.getByRole("button", { name: /Open #alerts/ }).click();
  await expect(page.getByRole("heading", { name: "alerts" })).toBeVisible();
});

test("keyboard users can operate the command palette", async ({ page }) => {
  await page.goto("/rooms/soc-operations");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  const input = page.getByPlaceholder("Type a command or search rooms");
  await expect(input).toBeFocused();
  await page.keyboard.type("alerts");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "alerts" })).toBeVisible();
});

test("room posts a durable message and receives its SSE update", async ({
  page,
}, testInfo) => {
  await page.goto("/rooms/investigation-suspicious-powershell");
  await expect(
    page.getByRole("heading", { name: "investigation-suspicious-powershell" }),
  ).toBeVisible();
  const note = `Playwright message from ${testInfo.project.name} ${Date.now()}`;
  const composer = page.locator(".tiptap");
  await composer.fill(note);
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Second line preserved");
  await expect(composer).toContainText("Second line preserved");
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Send", exact: true }).click();
  } else {
    await page.keyboard.press("Enter");
  }
  await expect(page.getByTestId("live-event")).toContainText(
    "room.message.created",
  );
  await expect(composer).toBeEmpty();
  await expect(page.getByText(note).last()).toBeVisible();
  await page.reload();
  await expect(page.getByText(note).last()).toBeVisible();
});

test("room reactions toggle and thread replies persist", async ({
  page,
}, testInfo) => {
  await page.goto("/rooms/investigation-suspicious-powershell");
  const reaction = page.getByRole("button", { name: "Reviewing, 3" });
  await reaction.click();
  await expect(
    page.getByRole("button", { name: "Reviewing, 2" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reviewing, 2" }).click();
  await expect(
    page.getByRole("button", { name: "Reviewing, 3" }),
  ).toBeVisible();

  const replyText = `Persistent thread reply from ${testInfo.project.name} ${Date.now()}`;
  await page.getByRole("button", { name: "3 replies" }).click();
  await page.getByLabel("Reply to thread").fill(replyText);
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Reply", exact: true }).click();
  } else {
    await page.keyboard.press("Enter");
  }
  await expect(page.getByText(replyText)).toBeVisible();
  await page.reload();
  await expect(page.getByText(replyText)).toBeVisible();
});

test("thread export copies and downloads complete governed Markdown", async ({
  page,
  playwright,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const db = database();
  const [room] = await db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, "soc-operations"))
    .limit(1);
  if (!room) throw new Error("Seeded SOC operations room required");
  const [otherRoom] = await db
    .select()
    .from(schema.rooms)
    .where(
      and(
        eq(schema.rooms.organisationId, room.organisationId),
        eq(schema.rooms.slug, "detection-engineering"),
      ),
    )
    .limit(1);
  if (!otherRoom) throw new Error("Second seeded room required");
  const [human] = await db
    .select()
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, room.organisationId),
        eq(schema.actors.identityReference, "admin@muster.local"),
      ),
    )
    .limit(1);
  const [agent] = await db
    .select()
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, room.organisationId),
        eq(schema.actors.actorType, "agent"),
      ),
    )
    .limit(1);
  const [system] = await db
    .select()
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, room.organisationId),
        eq(schema.actors.actorType, "system"),
      ),
    )
    .limit(1);
  if (!human || !agent || !system) {
    throw new Error("Seeded human, agent, and system actors required");
  }

  const suffix = newId().slice(0, 8);
  const messageIds = [newId(), newId(), newId(), newId(), newId()];
  const evidenceId = newId();
  const secret = `synthetic-thread-secret-${suffix}`;
  const deletedCanary = `deleted-thread-canary-${suffix}`;
  const otherRoomCanary = `other-room-thread-canary-${suffix}`;
  const rootText = `Review synthetic thread ${suffix}`;
  const startedAt = new Date();
  const textDocument = (text: string) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  });

  try {
    await db.insert(schema.evidence).values({
      id: evidenceId,
      organisationId: room.organisationId,
      fileName: `synthetic-thread-${suffix}.json`,
      mimeType: "application/json",
      size: 128,
      sha256: `${"c".repeat(56)}${suffix}`.slice(0, 64),
      uploadedByActorId: human.id,
      classification: "internal",
      relatedRoomId: room.id,
      source: "synthetic-browser-test",
      storageKey: `${room.organisationId}/evidence/${evidenceId}/synthetic.json`,
      scanState: "clean",
      retentionState: "active",
    });
    await db.insert(schema.messages).values([
      {
        id: messageIds[0]!,
        organisationId: room.organisationId,
        roomId: room.id,
        authorActorId: human.id,
        messageType: "text",
        document: textDocument(rootText),
        plainText: rootText,
        createdAt: startedAt,
        idempotencyKey: `synthetic-thread-root:${messageIds[0]}`,
      },
      {
        id: messageIds[1]!,
        organisationId: room.organisationId,
        roomId: room.id,
        threadParentId: messageIds[0]!,
        authorActorId: agent.id,
        messageType: "text",
        document: textDocument("Synthetic agent analysis completed."),
        plainText: `Synthetic agent analysis completed. api_key=${secret}`,
        createdAt: new Date(startedAt.getTime() + 1_000),
        idempotencyKey: `synthetic-thread-agent:${messageIds[1]}`,
      },
      {
        id: messageIds[2]!,
        organisationId: room.organisationId,
        roomId: room.id,
        threadParentId: messageIds[0]!,
        authorActorId: system.id,
        messageType: "finding",
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Synthetic finding verified." }],
            },
            {
              type: "attachment",
              attrs: {
                id: evidenceId,
                label: `synthetic-thread-${suffix}.json`,
              },
            },
          ],
        },
        plainText: "Synthetic finding verified.",
        createdAt: new Date(startedAt.getTime() + 2_000),
        idempotencyKey: `synthetic-thread-finding:${messageIds[2]}`,
      },
      {
        id: messageIds[3]!,
        organisationId: room.organisationId,
        roomId: room.id,
        threadParentId: messageIds[0]!,
        authorActorId: human.id,
        messageType: "text",
        document: textDocument(deletedCanary),
        plainText: deletedCanary,
        createdAt: new Date(startedAt.getTime() + 3_000),
        deletedAt: new Date(startedAt.getTime() + 4_000),
        idempotencyKey: `synthetic-thread-deleted:${messageIds[3]}`,
      },
      {
        id: messageIds[4]!,
        organisationId: room.organisationId,
        roomId: otherRoom.id,
        threadParentId: messageIds[0]!,
        authorActorId: human.id,
        messageType: "text",
        document: textDocument(otherRoomCanary),
        plainText: otherRoomCanary,
        createdAt: new Date(startedAt.getTime() + 4_000),
        idempotencyKey: `synthetic-thread-other-room:${messageIds[4]}`,
      },
    ]);

    await page.goto(`/rooms/${room.slug}?thread=${messageIds[0]}`);
    await expect(page.getByRole("heading", { name: "Thread" })).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (
              globalThis as typeof globalThis & {
                __musterCopiedThread?: string;
              }
            ).__musterCopiedThread = text;
          },
        },
      });
    });
    await page.getByRole("button", { name: "Thread actions" }).click();
    await page.getByRole("menuitem", { name: "Copy thread" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Thread copied as Markdown." }),
    ).toBeVisible();
    const markdown = await page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __musterCopiedThread?: string;
          }
        ).__musterCopiedThread,
    );
    expect(markdown).toContain(`# ${room.displayName} thread`);
    expect(markdown).toContain(rootText);
    expect(markdown).toContain(`${human.displayName} (Human)`);
    expect(markdown).toContain(`${agent.displayName} (Agent)`);
    expect(markdown).toContain(`${system.displayName} (System)`);
    expect(markdown).toContain("**Entry type:** Investigation finding");
    expect(markdown).toContain(`/api/v1/evidence/${evidenceId}`);
    expect(markdown).toContain("\\[REDACTED\\]");
    expect(markdown).not.toContain(secret);
    expect(markdown).not.toContain(deletedCanary);
    expect(markdown).not.toContain(otherRoomCanary);
    expect(markdown?.match(/^## Reply /gm)).toHaveLength(2);

    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("Synthetic clipboard denial");
          },
        },
      });
    });
    await page.getByRole("button", { name: "Thread actions" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Copy thread" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `${room.slug}-thread-${messageIds[0]!.slice(0, 8)}.md`,
    );
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Clipboard unavailable; Markdown downloaded." }),
    ).toBeVisible();

    const audits = await db
      .select({ id: schema.auditEvents.id })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.organisationId, room.organisationId),
          eq(schema.auditEvents.action, "room.thread.exported"),
          eq(schema.auditEvents.targetId, messageIds[0]!),
        ),
      );
    expect(audits).toHaveLength(2);

    const baseURL = testInfo.project.use.baseURL?.toString();
    if (!baseURL) throw new Error("Playwright baseURL required");
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      expect(
        (
          await anonymous.get(
            `/api/v1/rooms/${room.id}/threads/${messageIds[0]}/export`,
          )
        ).status(),
      ).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  } finally {
    await db
      .delete(schema.messages)
      .where(inArray(schema.messages.id, messageIds));
    await db.delete(schema.evidence).where(eq(schema.evidence.id, evidenceId));
  }
});

test("composer drafts persist and theme control works", async ({
  page,
}, testInfo) => {
  const draft = `Unsent draft ${testInfo.project.name} ${Date.now()}`;
  await page.goto("/rooms/soc-operations");
  const composer = page.locator(".tiptap");
  await composer.fill(draft);
  await page.getByRole("button", { name: "User menu and theme" }).click();
  await page.getByRole("menuitem", { name: "Use light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(composer).toContainText(draft);
});

test("investigation exposes hypotheses, findings, and promotion approval", async ({
  page,
}, testInfo) => {
  await page.goto("/investigations/INV-2026-0178/hypotheses");
  await expect(
    page.getByText("Stolen portal credentials were used"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Findings" }).click();
  await expect(
    page.getByText("Encoded PowerShell retrieved second-stage content"),
  ).toBeVisible();
  await page.getByRole("button", { name: /Promote to Kelpie/ }).click();
  const promotionReadiness =
    testInfo.project.name === "mobile"
      ? page.locator("#promotion-readiness")
      : page.locator(".context-panel");
  await expect(
    promotionReadiness.getByText(
      "Human approval required before case creation.",
    ),
  ).toBeVisible();
});

test("agent learning is evidence-backed and approval gated", async ({
  page,
}, testInfo) => {
  const agentId = "018f55d8-c4c7-7c3e-88ef-000000000020";
  const sourceRunId = newId();
  const skillKey = `browser-governance-${testInfo.project.name}-${Date.now()}`;
  const [definition] = await database()
    .select()
    .from(schema.agentDefinitions)
    .where(eq(schema.agentDefinitions.id, agentId))
    .limit(1);
  if (!definition) throw new Error("Seeded triage agent required");
  await database()
    .insert(schema.agentRuns)
    .values({
      id: sourceRunId,
      organisationId: definition.organisationId,
      agentId,
      requestedByActorId: definition.ownerActorId,
      investigationId: null,
      trigger: "browser_governance_test",
      status: "completed",
      request: { traceId: `browser-learning-${sourceRunId}` },
      progress: { stage: "completed", percent: 100 },
      startedAt: new Date(),
      completedAt: new Date(),
      inputHash: "a".repeat(64),
      outputHash: "b".repeat(64),
      promptVersion: definition.systemPromptVersion,
      runtime: "mock",
      model: definition.model,
      maximumRuntimeSeconds: definition.maximumRuntimeSeconds,
      maximumTokenBudget: definition.maximumTokenBudget,
      maximumCostCents: definition.maximumCostCents,
      idempotencyKey: `browser-learning:${sourceRunId}`,
    });
  const allowedTools = Array.isArray(definition.allowedTools)
    ? definition.allowedTools.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const requiredCapabilities = Array.isArray(definition.capabilityRequirements)
    ? definition.capabilityRequirements.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const proposed = await page.request.post(
    `/api/v1/agents/${agentId}/learning`,
    {
      data: {
        action: "propose_skill",
        sourceRunId,
        proposal: {
          skillKey,
          name: `Browser governed skill ${testInfo.project.name}`,
          description:
            "Synthetic browser proposal proving evaluation and human approval.",
          content: `# Browser governed procedure\n\nSynthetic proposal ${skillKey}. Read only organisation-scoped evidence supplied by Muster. Compare identifiers and timestamps, cite every supporting record, preserve contradictions, and return uncertainty for human review. Never perform an external action.`,
          changeRationale:
            "A synthetic completed run demonstrates the governed browser review.",
          evidenceReferences: [`agent-run:${sourceRunId}`],
          requiredCapabilities,
          allowedTools,
        },
      },
    },
  );
  expect(proposed.status()).toBe(200);

  await page.goto(`/agents/${agentId}/learning`);
  await expect(page.getByText("Governed continuous learning")).toBeVisible();
  await expect(page.getByText("Evaluation + human approval")).toBeVisible();
  await expect(page.getByText("Never self-authorised")).toBeVisible();
  const proposal = page.getByRole("article").filter({ hasText: skillKey });
  await proposal.getByRole("button", { name: "Evaluate" }).click();
  await expect(proposal.getByText("100 / 100")).toBeVisible();
  await proposal.getByRole("button", { name: "Publish" }).click();
  await expect(proposal.getByText("active", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Kill switch" }).click();
  await expect(
    page.getByRole("button", { name: "Restore agent" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore agent" }).click();
  await expect(page.getByRole("button", { name: "Kill switch" })).toBeVisible();
  await proposal.getByRole("button", { name: "Retire" }).click();
  await expect(
    proposal.getByText("rolled_back", { exact: true }),
  ).toBeVisible();
});

test("agent readiness distinguishes ready, attention, unknown, and unauthorised views", async ({
  page,
  playwright,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const db = database();
  const definitions = await db.select().from(schema.agentDefinitions).limit(3);
  if (definitions.length < 3) {
    throw new Error("Three synthetic agent definitions required");
  }
  const processIdentity = `synthetic-readiness-process-${newId()}`;
  const verifiedAt = new Date(Date.now() + 5 * 60_000);
  const snapshotIds = definitions.map(() => newId());

  try {
    await db.insert(schema.agentReadinessSnapshots).values(
      definitions.map((definition, index) => {
        const requestedPermissionMode =
          definition.requestedPermissionMode === "approval_gated"
            ? "approval_gated"
            : "read_only";
        return {
          id: snapshotIds[index]!,
          organisationId: definition.organisationId,
          agentId: definition.id,
          processIdentity,
          gatewayState: index === 2 ? "unknown" : "reported",
          authenticationState: "reported",
          observerState: "reported",
          lifecycleEvidenceState: "reported",
          lifecycleState: "idle",
          capabilityState: "reported",
          toolState: "reported",
          permissionState: "reported",
          reportedRuntime: "mock",
          reportedProvider: "synthetic",
          reportedModel: "synthetic-readiness-model",
          inputCapabilities: ["task", "investigation"],
          outputCapabilities: ["schema-valid security result"],
          availableCommands: ["run", "cancel"],
          toolSources: ["synthetic"],
          toolRiskClasses: ["read"],
          requestedPermissionMode,
          effectivePermissionMode:
            index === 1
              ? requestedPermissionMode === "read_only"
                ? "approval_gated"
                : "read_only"
              : requestedPermissionMode,
          limitations: ["Synthetic browser evidence only"],
          heartbeatAt: verifiedAt,
          verifiedAt,
        };
      }),
    );

    await page.goto("/agents");
    await expect(
      page.getByRole("heading", { name: "Agent directory" }),
    ).toBeVisible();
    const expectedStates = ["Ready", "Needs attention", "Unknown"];
    for (const [index, definition] of definitions.entries()) {
      const card = page
        .getByRole("link")
        .filter({ has: page.getByRole("heading", { name: definition.name }) });
      await expect(
        card.getByText(expectedStates[index]!, { exact: true }),
      ).toBeVisible();
      await expect(card).toContainText(definition.description);
    }

    await page.goto(`/agents/${definitions[0]!.id}`);
    await expect(
      page.getByRole("heading", { name: definitions[0]!.name }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Ready", exact: true }),
    ).toBeVisible();
    await page
      .getByText("Capabilities, permissions, and verification details")
      .click();
    await expect(page.getByText("Requested permission")).toBeVisible();
    await expect(page.getByText("Effective permission")).toBeVisible();
    await expect(page.getByText("gateway: reported")).toBeVisible();

    await page.goto(`/agents/${definitions[1]!.id}`);
    await expect(
      page.getByRole("heading", { name: "Needs attention", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Requested and effective permission modes diverge.", {
        exact: true,
      }),
    ).toBeVisible();

    await page.goto(`/agents/${definitions[2]!.id}`);
    await expect(
      page.getByRole("heading", { name: "Unknown", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Required runtime evidence is unknown.", { exact: true }),
    ).toBeVisible();

    await page.goto("/tasks");
    await page.getByRole("button", { name: "New task" }).click();
    const readyOption = page
      .getByLabel("Assign to")
      .locator(`option[value="${definitions[0]!.id}"]`);
    await expect(readyOption).toContainText("Ready");
    await expect(readyOption).toContainText(
      definitions[0]!.description.slice(0, 30),
    );

    const baseURL = testInfo.project.use.baseURL?.toString();
    if (!baseURL) throw new Error("Playwright baseURL required");
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      expect((await anonymous.get("/api/v1/agents")).status()).toBe(401);
      expect(
        (
          await anonymous.get(`/api/v1/agents/${definitions[0]!.id}/readiness`)
        ).status(),
      ).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  } finally {
    await db
      .delete(schema.agentReadinessSnapshots)
      .where(inArray(schema.agentReadinessSnapshots.id, snapshotIds));
  }
});

test("room shows scoped live multi-agent activity and run timeline", async ({
  page,
  playwright,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const db = database();
  const [room] = await db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, "soc-operations"))
    .limit(1);
  if (!room) throw new Error("Seeded SOC operations room required");
  const definitions = await db
    .select()
    .from(schema.agentDefinitions)
    .where(eq(schema.agentDefinitions.organisationId, room.organisationId))
    .limit(3);
  if (definitions.length < 3) {
    throw new Error("Three synthetic agent definitions required");
  }
  const [otherRoom] = await db
    .select()
    .from(schema.rooms)
    .where(
      and(
        eq(schema.rooms.organisationId, room.organisationId),
        eq(schema.rooms.slug, "detection-engineering"),
      ),
    )
    .limit(1);
  if (!otherRoom) throw new Error("Second seeded room required");

  const now = new Date();
  const runIds = [newId(), newId(), newId(), newId()];
  const taskIds = [newId(), newId()];
  const eventIds = [newId(), newId(), newId(), newId()];
  const syntheticSecret = `synthetic-room-secret-${newId()}`;

  try {
    await db.insert(schema.agentRuns).values([
      {
        id: runIds[0]!,
        agentId: definitions[0]!.id,
        organisationId: room.organisationId,
        roomId: room.id,
        requestedByActorId: definitions[0]!.ownerActorId,
        trigger: "task",
        status: "running",
        progress: { stage: "analysis", percent: 35 },
        startedAt: new Date(now.getTime() - 65_000),
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
        deadlineAt: new Date(now.getTime() + 10 * 60_000),
        workerId: "synthetic-room-worker",
        inputHash: `synthetic-input-${runIds[0]}`,
        promptVersion: "synthetic-room-v1",
        runtime: "mock",
        model: "synthetic-room-model",
        idempotencyKey: `synthetic-room-run:${runIds[0]}`,
      },
      {
        id: runIds[1]!,
        agentId: definitions[1]!.id,
        organisationId: room.organisationId,
        roomId: room.id,
        requestedByActorId: definitions[1]!.ownerActorId,
        trigger: "task",
        status: "running",
        progress: { stage: "verification", percent: 60 },
        startedAt: new Date(now.getTime() - 35_000),
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
        deadlineAt: new Date(now.getTime() + 10 * 60_000),
        workerId: "synthetic-room-worker",
        inputHash: `synthetic-input-${runIds[1]}`,
        promptVersion: "synthetic-room-v1",
        runtime: "mock",
        model: "synthetic-room-model",
        idempotencyKey: `synthetic-room-run:${runIds[1]}`,
      },
      {
        id: runIds[2]!,
        agentId: definitions[2]!.id,
        organisationId: room.organisationId,
        roomId: room.id,
        requestedByActorId: definitions[2]!.ownerActorId,
        trigger: "task",
        status: "running",
        progress: { stage: "stale", percent: 10 },
        startedAt: new Date(now.getTime() - 10 * 60_000),
        heartbeatAt: new Date(now.getTime() - 5 * 60_000),
        leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
        deadlineAt: new Date(now.getTime() + 10 * 60_000),
        workerId: "synthetic-room-worker",
        inputHash: `synthetic-input-${runIds[2]}`,
        promptVersion: "synthetic-room-v1",
        runtime: "mock",
        model: "synthetic-room-model",
        idempotencyKey: `synthetic-room-run:${runIds[2]}`,
      },
      {
        id: runIds[3]!,
        agentId: definitions[2]!.id,
        organisationId: room.organisationId,
        roomId: otherRoom.id,
        requestedByActorId: definitions[2]!.ownerActorId,
        trigger: "task",
        status: "running",
        progress: { stage: "unrelated", percent: 50 },
        startedAt: new Date(now.getTime() - 20_000),
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
        deadlineAt: new Date(now.getTime() + 10 * 60_000),
        workerId: "synthetic-room-worker",
        inputHash: `synthetic-input-${runIds[3]}`,
        promptVersion: "synthetic-room-v1",
        runtime: "mock",
        model: "synthetic-room-model",
        idempotencyKey: `synthetic-room-run:${runIds[3]}`,
      },
    ]);
    await db.insert(schema.tasks).values(
      taskIds.map((id, index) => ({
        id,
        organisationId: room.organisationId,
        title: `Synthetic room activity ${index + 1}`,
        status: "in_progress" as const,
        createdByActorId: definitions[index]!.ownerActorId,
        roomId: room.id,
        idempotencyKey: `synthetic-room-task:${id}`,
        agentRunId: runIds[index]!,
        agentRunStatus: "running",
      })),
    );
    await db.insert(schema.agentRunEvents).values([
      {
        id: eventIds[0]!,
        organisationId: room.organisationId,
        runId: runIds[0]!,
        eventType: "prompt_prepared",
        message: `Investigating synthetic room evidence api_key=${syntheticSecret}`,
        createdAt: new Date(now.getTime() - 4_000),
      },
      {
        id: eventIds[1]!,
        organisationId: room.organisationId,
        runId: runIds[0]!,
        eventType: "started",
        message: "Agent run claimed for execution",
        createdAt: new Date(now.getTime() - 2_000),
      },
      {
        id: eventIds[2]!,
        organisationId: room.organisationId,
        runId: runIds[1]!,
        eventType: "prompt_prepared",
        message: "Verifying synthetic controls and evidence",
        createdAt: new Date(now.getTime() - 3_000),
      },
      {
        id: eventIds[3]!,
        organisationId: room.organisationId,
        runId: runIds[1]!,
        eventType: "started",
        message: "Agent run claimed for execution",
        createdAt: new Date(now.getTime() - 1_000),
      },
    ]);

    await page.goto(`/rooms/${room.slug}`);
    const activity = page.getByTestId("room-agent-activity");
    await expect(activity).toContainText("2 agents working");
    await expect(
      activity.getByRole("button", { name: "View all" }),
    ).toBeVisible();
    await expect(activity).toContainText("[REDACTED]");
    await expect(activity).not.toContainText(syntheticSecret);

    await activity.getByRole("button", { name: "View all" }).click();
    let panel = page.getByTestId("agent-activity-panel");
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: definitions[0]!.name }),
    ).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: definitions[1]!.name }),
    ).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: definitions[2]!.name }),
    ).toHaveCount(0);

    const firstCard = panel
      .getByRole("article")
      .filter({ hasText: definitions[0]!.name });
    await firstCard.getByRole("button", { name: "View" }).click();
    await expect(
      panel.getByRole("heading", { name: "Run timeline" }),
    ).toBeVisible();
    await expect(
      panel.getByText("Investigating synthetic room evidence"),
    ).toBeVisible();
    await expect(
      panel.getByText("Agent run claimed for execution"),
    ).toBeVisible();
    await expect(panel).not.toContainText(syntheticSecret);

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await activity.getByRole("button", { name: "View all" }).click();
    panel = page.getByTestId("agent-activity-panel");
    await expect(panel).toBeVisible();
    expect((await panel.boundingBox())?.width).toBe(390);
    await panel
      .getByRole("button", { name: "Close agent activity panel" })
      .click();
    await expect(panel).toBeHidden();

    await activity.getByRole("button", { name: "View all" }).click();
    await page.goto(`/rooms/${otherRoom.slug}`);
    await expect(page.getByTestId("agent-activity-panel")).toHaveCount(0);

    await db
      .update(schema.agentRuns)
      .set({ heartbeatAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(schema.agentRuns.id, runIds[1]!));
    await page.goto(`/rooms/${room.slug}`);
    const singleActivity = page.getByTestId("room-agent-activity");
    await expect(singleActivity).toContainText(definitions[0]!.name);
    await expect(
      singleActivity.getByRole("button", { name: "View all" }),
    ).toHaveCount(0);

    const baseURL = testInfo.project.use.baseURL?.toString();
    if (!baseURL) throw new Error("Playwright baseURL required");
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      expect(
        (
          await anonymous.get(`/api/v1/rooms/${room.id}/agent-activity`)
        ).status(),
      ).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  } finally {
    await db.delete(schema.tasks).where(inArray(schema.tasks.id, taskIds));
    await db
      .delete(schema.agentRunEvents)
      .where(inArray(schema.agentRunEvents.id, eventIds));
    await db
      .delete(schema.agentRuns)
      .where(inArray(schema.agentRuns.id, runIds));
  }
});

test("completed agent handoffs stay truthful, scoped, and inspectable", async ({
  page,
  playwright,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const db = database();
  const [room] = await db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, "soc-operations"))
    .limit(1);
  if (!room) throw new Error("Seeded SOC operations room required");
  const [agent] = await db
    .select()
    .from(schema.agentDefinitions)
    .where(eq(schema.agentDefinitions.organisationId, room.organisationId))
    .limit(1);
  if (!agent) throw new Error("Synthetic agent definition required");

  const suffix = newId().slice(0, 8);
  const runIds = [newId(), newId(), newId()];
  const taskIds = [newId(), newId(), newId()];
  const eventIds = [newId(), newId(), newId()];
  const evidenceId = newId();
  const now = new Date();
  const titles = {
    completed: `Synthetic completed handoff ${suffix}`,
    blocked: `Synthetic blocked handoff ${suffix}`,
    failed: `Synthetic failed handoff ${suffix}`,
  };

  try {
    await db.insert(schema.evidence).values({
      id: evidenceId,
      organisationId: room.organisationId,
      fileName: `synthetic-handoff-${suffix}.json`,
      mimeType: "application/json",
      size: 128,
      sha256: `${"a".repeat(56)}${suffix}`.slice(0, 64),
      uploadedByActorId: agent.ownerActorId,
      classification: "internal",
      relatedRoomId: room.id,
      source: "synthetic-browser-test",
      storageKey: `${room.organisationId}/evidence/${evidenceId}/synthetic.json`,
      scanState: "clean",
      retentionState: "active",
    });
    await db.insert(schema.agentRuns).values([
      {
        id: runIds[0]!,
        agentId: agent.id,
        organisationId: room.organisationId,
        roomId: room.id,
        requestedByActorId: agent.ownerActorId,
        trigger: "task",
        status: "completed",
        request: { humanRequest: "Confirm the synthetic endpoint is safe." },
        startedAt: new Date(now.getTime() - 60_000),
        completedAt: now,
        inputHash: `synthetic-handoff-input-${runIds[0]}`,
        outputHash: "b".repeat(64),
        promptVersion: "synthetic-handoff-v1",
        runtime: "mock",
        model: "synthetic-handoff-model",
        structuredOutput: {
          summary: "Synthetic endpoint activity was benign.",
          evidenceReferences: [
            {
              type: "muster.evidence",
              reference: evidenceId,
              sha256: null,
            },
          ],
        },
        idempotencyKey: `synthetic-handoff-run:${runIds[0]}`,
      },
      {
        id: runIds[1]!,
        agentId: agent.id,
        organisationId: room.organisationId,
        roomId: room.id,
        requestedByActorId: agent.ownerActorId,
        trigger: "task",
        status: "failed",
        request: { humanRequest: "Publish the synthetic response action." },
        startedAt: new Date(now.getTime() - 50_000),
        completedAt: now,
        inputHash: `synthetic-handoff-input-${runIds[1]}`,
        promptVersion: "synthetic-handoff-v1",
        runtime: "mock",
        model: "synthetic-handoff-model",
        failureCode: "blocked_approval",
        error: "Synthetic approval is required before publication.",
        idempotencyKey: `synthetic-handoff-run:${runIds[1]}`,
      },
      {
        id: runIds[2]!,
        agentId: agent.id,
        organisationId: room.organisationId,
        roomId: room.id,
        requestedByActorId: agent.ownerActorId,
        trigger: "task",
        status: "failed",
        request: { humanRequest: "Inspect the synthetic unavailable source." },
        startedAt: new Date(now.getTime() - 40_000),
        completedAt: now,
        inputHash: `synthetic-handoff-input-${runIds[2]}`,
        promptVersion: "synthetic-handoff-v1",
        runtime: "mock",
        model: "synthetic-handoff-model",
        failureCode: "synthetic_failure",
        error: "Synthetic source was unavailable.",
        idempotencyKey: `synthetic-handoff-run:${runIds[2]}`,
      },
    ]);
    await db.insert(schema.tasks).values([
      {
        id: taskIds[0]!,
        organisationId: room.organisationId,
        title: titles.completed,
        description: "Confirm the synthetic endpoint is safe.",
        status: "review",
        assignedActorId: agent.id,
        createdByActorId: agent.ownerActorId,
        roomId: room.id,
        idempotencyKey: `synthetic-handoff-task:${taskIds[0]}`,
        agentRunId: runIds[0]!,
        agentRunStatus: "completed",
      },
      {
        id: taskIds[1]!,
        organisationId: room.organisationId,
        title: titles.blocked,
        description: "Publish the synthetic response action.",
        status: "ready",
        assignedActorId: agent.id,
        createdByActorId: agent.ownerActorId,
        roomId: room.id,
        idempotencyKey: `synthetic-handoff-task:${taskIds[1]}`,
        agentRunId: runIds[1]!,
        agentRunStatus: "failed",
      },
      {
        id: taskIds[2]!,
        organisationId: room.organisationId,
        title: titles.failed,
        description: "Inspect the synthetic unavailable source.",
        status: "ready",
        assignedActorId: agent.id,
        createdByActorId: agent.ownerActorId,
        roomId: room.id,
        idempotencyKey: `synthetic-handoff-task:${taskIds[2]}`,
        agentRunId: runIds[2]!,
        agentRunStatus: "failed",
      },
    ]);
    await db.insert(schema.agentRunEvents).values([
      {
        id: eventIds[0]!,
        organisationId: room.organisationId,
        runId: runIds[0]!,
        eventType: "verification_passed",
        message: "Synthetic retained evidence matched the expected digest.",
      },
      {
        id: eventIds[1]!,
        organisationId: room.organisationId,
        runId: runIds[1]!,
        eventType: "blocked",
        message: "Synthetic approval gate blocked execution.",
      },
      {
        id: eventIds[2]!,
        organisationId: room.organisationId,
        runId: runIds[2]!,
        eventType: "failed",
        message: "Synthetic source retrieval failed.",
      },
    ]);

    await page.goto("/tasks");
    const completedTask = page
      .getByRole("article")
      .filter({ hasText: titles.completed })
      .first();
    const blockedTask = page
      .getByRole("article")
      .filter({ hasText: titles.blocked })
      .first();
    const failedTask = page
      .getByRole("article")
      .filter({ hasText: titles.failed })
      .first();
    await expect(
      completedTask.getByLabel("Agent handoff: Completed"),
    ).toBeVisible();
    await expect(
      completedTask.getByText("Synthetic endpoint activity was benign."),
    ).toBeVisible();
    await expect(
      completedTask.getByText(
        /Persisted verification: Synthetic retained evidence/,
      ),
    ).toBeVisible();
    await expect(
      completedTask.getByRole("link", {
        name: `synthetic-handoff-${suffix}.json`,
      }),
    ).toHaveAttribute("href", `/api/v1/evidence/${evidenceId}`);
    await expect(
      blockedTask.getByLabel("Agent handoff: Blocked"),
    ).toBeVisible();
    await expect(
      blockedTask.getByText(
        "Synthetic approval is required before publication.",
      ),
    ).toBeVisible();
    await expect(failedTask.getByLabel("Agent handoff: Failed")).toBeVisible();
    await expect(
      failedTask.getByText("Synthetic source was unavailable."),
    ).toBeVisible();

    await completedTask
      .getByRole("button", { name: "View full timeline" })
      .click();
    const timeline = page.getByRole("dialog", {
      name: "Full agent run timeline",
    });
    await expect(timeline).toBeVisible();
    await expect(
      timeline.getByText(
        "Synthetic retained evidence matched the expected digest.",
      ),
    ).toBeVisible();
    await timeline
      .getByRole("button", { name: "Close full agent run timeline" })
      .click();

    await page.goto("/rooms/soc-operations");
    const roomHandoffs = page.getByTestId("room-agent-handoffs");
    await expect(roomHandoffs).toContainText(
      "Synthetic endpoint activity was benign.",
    );
    await expect(roomHandoffs).toContainText(
      "Synthetic approval is required before publication.",
    );
    await expect(roomHandoffs).toContainText(
      "Synthetic source was unavailable.",
    );

    const baseURL = testInfo.project.use.baseURL?.toString();
    if (!baseURL) throw new Error("Playwright baseURL required");
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      for (const path of [
        `/api/v1/rooms/${room.id}/agent-handoffs`,
        `/api/v1/agent-runs/${runIds[0]}/timeline`,
        `/api/v1/evidence/${evidenceId}`,
      ]) {
        expect((await anonymous.get(path)).status(), path).toBe(401);
      }
    } finally {
      await anonymous.dispose();
    }
  } finally {
    await db.delete(schema.tasks).where(inArray(schema.tasks.id, taskIds));
    await db
      .delete(schema.agentRunEvents)
      .where(inArray(schema.agentRunEvents.id, eventIds));
    await db
      .delete(schema.agentRuns)
      .where(inArray(schema.agentRuns.id, runIds));
    await db.delete(schema.evidence).where(eq(schema.evidence.id, evidenceId));
  }
});

test("task board manages durable agent work end to end", async ({
  page,
}, testInfo) => {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(
    page.getByText("Threat hunt the unusual authentication alert"),
  ).toBeVisible();

  const taskTitle = `Review security signal ${testInfo.project.name} ${Date.now()}`;
  const caseReference = `CASE-SYNTHETIC-${newId().slice(0, 8)}`;
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByPlaceholder("What needs doing?").fill(taskTitle);
  await page
    .getByPlaceholder("Context, constraints, and deliverable")
    .fill("Correlate the signal and return an evidence-linked review draft.");
  await page.getByLabel("Due").fill("2026-08-15T15:30");
  await page.getByLabel("Priority").selectOption("high");
  await page
    .getByLabel("Room", { exact: true })
    .selectOption({ label: "#soc-operations" });
  await page.getByPlaceholder("Optional case ID").fill(caseReference);
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByText(taskTitle)).toBeVisible();

  let taskCard = page.getByRole("article").filter({ hasText: taskTitle });
  await taskCard.getByRole("button", { name: `Edit ${taskTitle}` }).click();
  await page
    .getByPlaceholder("Context, constraints, and deliverable")
    .fill("Edited synthetic outcome with evidence and a human review.");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(
    taskCard.getByText("Edited synthetic outcome with evidence"),
  ).toBeVisible();

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tasks/"),
    ),
    page.getByRole("button", { name: `Move ${taskTitle} right` }).click(),
  ]);

  await page.reload();
  const readyColumn = page
    .getByRole("heading", { name: "Ready" })
    .locator("xpath=ancestor::section");
  await expect(readyColumn.getByText(taskTitle)).toBeVisible();
  await expect(readyColumn.getByText(`Case ${caseReference}`)).toBeVisible();

  taskCard = page.getByRole("article").filter({ hasText: taskTitle });
  await taskCard.getByRole("button", { name: "Delegate" }).click();
  await expect(taskCard.getByText(/Agent (queued|running)/)).toBeVisible();
  await taskCard.getByRole("button", { name: "Cancel" }).click();
  await expect(taskCard.getByText("Agent cancelled")).toBeVisible();
  await expect(taskCard.getByRole("button", { name: "Retry" })).toBeVisible();

  await taskCard.getByRole("button", { name: "Retry" }).click();
  const reviewColumn = page
    .getByRole("heading", { name: "Review", exact: true })
    .locator("xpath=ancestor::section");
  await expect(
    reviewColumn.getByRole("heading", { name: taskTitle, exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  taskCard = reviewColumn.getByRole("article").filter({ hasText: taskTitle });
  await expect(taskCard.getByText("Agent completed")).toBeVisible();
  await expect(taskCard.getByLabel("Agent handoff: Completed")).toBeVisible();
  await expect(
    taskCard.getByText(/Synthetic analysis completed for:/),
  ).toBeVisible();
  await expect(
    taskCard.getByText("No persisted verification evidence was recorded."),
  ).toBeVisible();
  await taskCard.getByRole("button", { name: "Mark done" }).click();
  const doneColumn = page
    .getByRole("heading", { name: "Done", exact: true })
    .locator("xpath=ancestor::section");
  await expect(
    doneColumn.getByRole("heading", { name: taskTitle, exact: true }),
  ).toBeVisible();
});

test("task APIs deny cross-organisation references and runs", async ({
  page,
}, testInfo) => {
  const db = database();
  const foreignOrganisationId = newId();
  const foreignActorId = newId();
  const foreignRoomId = newId();
  const foreignTaskId = newId();
  const foreignRunId = newId();
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  let ownTaskId: string | null = null;

  try {
    await db.insert(schema.organisations).values({
      id: foreignOrganisationId,
      name: `Synthetic foreign organisation ${suffix}`,
      slug: `synthetic-foreign-${suffix}`,
    });
    await db.insert(schema.actors).values({
      id: foreignActorId,
      organisationId: foreignOrganisationId,
      actorType: "human",
      displayName: "Synthetic foreign analyst",
      identityReference: `foreign-${suffix}@example.invalid`,
    });
    await db.insert(schema.rooms).values({
      id: foreignRoomId,
      organisationId: foreignOrganisationId,
      name: `foreign-room-${suffix}`,
      slug: `foreign-room-${suffix}`,
      displayName: "Synthetic foreign room",
      roomType: "operations",
      createdByActorId: foreignActorId,
    });
    await db.insert(schema.tasks).values({
      id: foreignTaskId,
      organisationId: foreignOrganisationId,
      title: "Synthetic foreign task",
      idempotencyKey: `foreign-task:${suffix}`,
      createdByActorId: foreignActorId,
      roomId: foreignRoomId,
      assignedActorId: foreignActorId,
      agentRunId: foreignRunId,
      agentRunStatus: "running",
    });

    for (const body of [
      { title: "Rejected foreign actor", assignedActorId: foreignActorId },
      { title: "Rejected foreign room", roomId: foreignRoomId },
    ]) {
      const response = await page.request.post("/api/v1/tasks", {
        data: body,
      });
      expect(response.status()).toBe(404);
    }

    const ownTask = await page.request.post("/api/v1/tasks", {
      data: { title: `Synthetic tenant-bound task ${suffix}` },
    });
    expect(ownTask.status()).toBe(201);
    ownTaskId = ((await ownTask.json()) as { data: { id: string } }).data.id;

    for (const body of [
      { assignedActorId: foreignActorId },
      { roomId: foreignRoomId },
    ]) {
      const response = await page.request.patch(`/api/v1/tasks/${ownTaskId}`, {
        data: body,
      });
      expect(response.status()).toBe(404);
    }
    expect(
      (
        await page.request.patch(`/api/v1/tasks/${foreignTaskId}`, {
          data: { title: "Cross-tenant mutation refused" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.post(`/api/v1/tasks/${foreignTaskId}/delegate`)
      ).status(),
    ).toBe(404);
    expect(
      (await page.request.get(`/api/v1/agent-runs/${foreignRunId}`)).status(),
    ).toBe(404);
  } finally {
    if (ownTaskId) {
      await db.delete(schema.tasks).where(eq(schema.tasks.id, ownTaskId));
    }
    await db.delete(schema.tasks).where(eq(schema.tasks.id, foreignTaskId));
    await db.delete(schema.rooms).where(eq(schema.rooms.id, foreignRoomId));
    await db.delete(schema.actors).where(eq(schema.actors.id, foreignActorId));
    await db
      .delete(schema.organisations)
      .where(eq(schema.organisations.id, foreignOrganisationId));
  }
});

test("agent observer APIs redact secrets for authorised and unauthorised callers", async ({
  page,
  playwright,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const db = database();
  const runId = newId();
  const taskId = newId();
  const eventId = newId();
  const canary = `synthetic-observer-secret-${newId()}`;
  const [definition] = await db.select().from(schema.agentDefinitions).limit(1);
  if (!definition) throw new Error("Seeded agent definition required");

  try {
    await db.insert(schema.agentRuns).values({
      id: runId,
      organisationId: definition.organisationId,
      agentId: definition.id,
      requestedByActorId: definition.ownerActorId,
      investigationId: null,
      trigger: "browser_redaction_test",
      status: "completed",
      request: { traceId: `browser-redaction-${runId}` },
      progress: { stage: "completed", percent: 100, apiKey: canary },
      startedAt: new Date(),
      completedAt: new Date(),
      inputHash: "c".repeat(64),
      outputHash: "d".repeat(64),
      outputSchema: "ExecutiveUpdate",
      structuredOutput: {
        headline: "Synthetic useful observer evidence",
        client_secret: canary,
      },
      error: `Authorization: Bearer ${canary}`,
      promptVersion: definition.systemPromptVersion,
      runtime: "mock",
      model: definition.model,
      maximumRuntimeSeconds: definition.maximumRuntimeSeconds,
      maximumTokenBudget: definition.maximumTokenBudget,
      maximumCostCents: definition.maximumCostCents,
      idempotencyKey: `browser-redaction:${runId}`,
    });
    await db.insert(schema.tasks).values({
      id: taskId,
      organisationId: definition.organisationId,
      title: "Synthetic observer redaction task",
      idempotencyKey: `browser-redaction-task:${taskId}`,
      createdByActorId: definition.ownerActorId,
      agentRunId: runId,
      agentRunStatus: "completed",
    });
    await db.insert(schema.agentRunEvents).values({
      id: eventId,
      organisationId: definition.organisationId,
      runId,
      eventType: "synthetic_observer_test",
      message: `Cookie: session=${canary}`,
      payload: { refreshToken: canary, evidenceCount: 3 },
    });

    for (const path of ["/api/v1/tasks", `/api/v1/agent-runs/${runId}`]) {
      const response = await page.request.get(path, {
        headers: { "x-trace-id": `password=${canary}` },
      });
      expect(response.ok(), path).toBe(true);
      const body = await response.text();
      expect(body).not.toContain(canary);
      expect(body).toContain("[REDACTED]");
      expect(body).toContain("Synthetic useful observer evidence");
    }

    const baseURL = testInfo.project.use.baseURL?.toString();
    if (!baseURL) throw new Error("Playwright baseURL required");
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      for (const path of ["/api/v1/tasks", `/api/v1/agent-runs/${runId}`]) {
        const response = await anonymous.get(path, {
          headers: { "x-trace-id": `password=${canary}` },
        });
        expect(response.status(), path).toBe(401);
        const body = await response.text();
        expect(body).not.toContain(canary);
      }
    } finally {
      await anonymous.dispose();
    }

    const [persisted] = await db
      .select({
        structuredOutput: schema.agentRuns.structuredOutput,
        error: schema.agentRuns.error,
      })
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, runId))
      .limit(1);
    expect(JSON.stringify(persisted)).toContain(canary);
  } finally {
    await db
      .delete(schema.agentRunEvents)
      .where(eq(schema.agentRunEvents.id, eventId));
    await db.delete(schema.tasks).where(eq(schema.tasks.id, taskId));
    await db.delete(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
  }
});

test("live search filters persist in URL history and exclude private rooms", async ({
  page,
  playwright,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const db = database();
  const [requester] = await db
    .select()
    .from(schema.actors)
    .where(eq(schema.actors.identityReference, "admin@muster.local"))
    .limit(1);
  const [visibleRoom] = await db
    .select()
    .from(schema.rooms)
    .where(eq(schema.rooms.slug, "soc-operations"))
    .limit(1);
  if (!requester || !visibleRoom) {
    throw new Error("Seeded search requester and room required");
  }

  const suffix = newId().slice(-8);
  const authorId = newId();
  const authorIdentity = `search-${authorId}@example.invalid`;
  const privateRoomId = newId();
  const messageIds = [newId(), newId(), newId()];
  const authorName = `Synthetic Search Author ${suffix}`;
  const canary = `searchbrowsercanary${suffix}`;
  const visibleInside = `${canary} visible inside date window`;
  const visibleBefore = `${canary} visible before date window`;
  const privateInside = `${canary} private excluded result`;

  try {
    await db.insert(schema.actors).values({
      id: authorId,
      organisationId: requester.organisationId,
      actorType: "human",
      displayName: authorName,
      identityReference: authorIdentity,
      capabilityAssignments: ["rooms.read"],
    });
    await db.insert(schema.rooms).values({
      id: privateRoomId,
      organisationId: requester.organisationId,
      name: `synthetic-search-private-${suffix}`,
      slug: `synthetic-search-private-${suffix}`,
      displayName: `Synthetic Search Private ${suffix}`,
      roomType: "private",
      visibility: "private",
      createdByActorId: requester.id,
    });
    await db.insert(schema.roomMemberships).values([
      {
        organisationId: requester.organisationId,
        roomId: visibleRoom.id,
        actorId: authorId,
        membershipRole: "member",
      },
      {
        organisationId: requester.organisationId,
        roomId: privateRoomId,
        actorId: authorId,
        membershipRole: "owner",
      },
    ]);
    await db.insert(schema.messages).values([
      {
        id: messageIds[0]!,
        organisationId: requester.organisationId,
        roomId: visibleRoom.id,
        authorActorId: authorId,
        messageType: "text",
        document: { type: "doc", content: [] },
        plainText: visibleInside,
        createdAt: new Date("2026-07-15T12:00:00.000Z"),
      },
      {
        id: messageIds[1]!,
        organisationId: requester.organisationId,
        roomId: visibleRoom.id,
        authorActorId: authorId,
        messageType: "text",
        document: { type: "doc", content: [] },
        plainText: visibleBefore,
        createdAt: new Date("2026-06-30T23:59:59.000Z"),
      },
      {
        id: messageIds[2]!,
        organisationId: requester.organisationId,
        roomId: privateRoomId,
        authorActorId: authorId,
        messageType: "text",
        document: { type: "doc", content: [] },
        plainText: privateInside,
        createdAt: new Date("2026-07-15T12:00:00.000Z"),
      },
    ]);

    await page.goto("/search");
    await expect(
      page.getByRole("heading", { name: "Search your workspace" }),
    ).toBeVisible();
    const input = page.getByPlaceholder(
      "Search or filter with from:, in:, after:, before:",
    );
    const filteredQuery = `${canary} from:"${authorIdentity}" in:"${visibleRoom.displayName}" after:2026-07-01 before:2026-08-01`;
    await input.fill(filteredQuery);
    const initialSearch = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/search?q=") &&
        response.request().method() === "GET",
    );
    await page.getByRole("button", { name: "Search", exact: true }).click();
    expect((await initialSearch).ok()).toBe(true);
    await expect(page.getByText(visibleInside)).toBeVisible();
    await expect(page.getByText(visibleBefore)).toHaveCount(0);
    await expect(page.getByText(privateInside)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Remove from filter" }),
    ).toContainText(authorName);
    await expect(
      page.getByRole("button", { name: "Remove in filter" }),
    ).toContainText(visibleRoom.displayName);
    await expect(page).toHaveURL(/after%3A2026-07-01/);

    const filterRemovalSearch = page.waitForResponse((response) =>
      response.url().includes("/api/v1/search?q="),
    );
    await page.getByRole("button", { name: "Remove after filter" }).click();
    expect((await filterRemovalSearch).ok()).toBe(true);
    await expect(page.getByText(visibleBefore)).toBeVisible();
    await expect(page.getByText(privateInside)).toHaveCount(0);
    const historySearch = page.waitForResponse((response) =>
      response.url().includes("/api/v1/search?q="),
    );
    await page.goBack();
    expect((await historySearch).ok()).toBe(true);
    await expect(page.getByText(visibleInside)).toBeVisible();
    await expect(page.getByText(visibleBefore)).toHaveCount(0);
    const reloadSearch = page.waitForResponse((response) =>
      response.url().includes("/api/v1/search?q="),
    );
    await page.reload();
    expect((await reloadSearch).ok()).toBe(true);
    await expect(input).toHaveValue(filteredQuery);
    await expect(page.getByText(visibleInside)).toBeVisible();

    await input.fill(`${canary} from:"Unknown Synthetic Actor"`);
    const invalidSearch = page.waitForResponse((response) =>
      response.url().includes("/api/v1/search?q="),
    );
    await page.getByRole("button", { name: "Search", exact: true }).click();
    expect((await invalidSearch).status()).toBe(400);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Unknown from: search filter" }),
    ).toContainText('Unknown from: search filter "Unknown Synthetic Actor".');
    await expect(page.getByText(privateInside)).toHaveCount(0);

    const baseURL = testInfo.project.use.baseURL?.toString();
    if (!baseURL) throw new Error("Playwright baseURL required");
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      expect((await anonymous.get(`/api/v1/search?q=${canary}`)).status()).toBe(
        401,
      );
    } finally {
      await anonymous.dispose();
    }
  } finally {
    await db
      .delete(schema.messages)
      .where(inArray(schema.messages.id, messageIds));
    await db
      .delete(schema.roomMemberships)
      .where(eq(schema.roomMemberships.actorId, authorId));
    await db.delete(schema.rooms).where(eq(schema.rooms.id, privateRoomId));
    await db.delete(schema.actors).where(eq(schema.actors.id, authorId));
  }
});

test("workflow YAML editor, integrations, search, and approvals render", async ({
  page,
}) => {
  await page.goto("/workflows/suspicious-powershell-triage");
  await expect(page.getByText("Schema valid")).toBeVisible();
  await page.goto("/integrations/bower");
  await expect(
    page.getByText("Heartbeat and queue state do not prove"),
  ).toBeVisible();
  await page.goto("/search");
  await expect(page.getByText("0 permission-filtered results")).toBeVisible();
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  await expect(page.getByText("No approval records.")).toBeVisible();
});

test("mobile navigation supports channel work", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Workspace" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /alerts/ }).click();
  await expect(page.getByRole("heading", { name: "alerts" })).toBeVisible();
});

test("core workbench has no horizontal overflow at supported widths", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");

  for (const width of [320, 375, 414, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/rooms/soc-operations");
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth, `${width}px viewport`).toBeLessThanOrEqual(
      overflow.clientWidth,
    );
  }
});

test("core workbench passes accessibility and console quality gates", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  for (const route of [
    "/rooms/soc-operations",
    "/tasks",
    "/investigations/INV-2026-0178",
    "/settings",
    "/workflows/suspicious-powershell-triage",
  ]) {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations,
      `${route}: ${results.violations
        .map((violation) => `${violation.id} (${violation.nodes.length})`)
        .join(", ")}`,
    ).toEqual([]);
  }

  expect(errors).toEqual([]);
});

test("core workbench reflows at a 200 percent zoom equivalent", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/rooms/soc-operations");
  await expect(
    page.getByRole("heading", { name: "soc-operations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});
