import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthorisationSubject } from "@muster/authz";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, count, eq } from "drizzle-orm";
import { agentProfileState, mutateAgentProfile } from "./agent-profile-domain";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("governed agent profile lifecycle", () => {
  let organisationId = "";
  let agentId = "";
  let actorIdA = ""; // proposer / first administrator, seeded owner actor
  let actorIdB = ""; // synthetic second administrator, distinct approver

  beforeAll(async () => {
    const [definition] = await database()
      .select()
      .from(schema.agentDefinitions)
      .limit(1);
    if (!definition) throw new Error("Seeded agent definition required");
    organisationId = definition.organisationId;
    agentId = definition.id;
    actorIdA = definition.ownerActorId;

    actorIdB = newId();
    await database()
      .insert(schema.actors)
      .values({
        id: actorIdB,
        organisationId,
        actorType: "human",
        displayName: "Synthetic Profile Approver",
        identityReference: `synthetic:profile-approver@muster.test:${actorIdB}`,
        capabilityAssignments: ["agents.read", "agents.manage"],
      });
  });

  afterAll(closeDatabase);

  function context(actorId: string) {
    return {
      organisationId,
      actorId,
      agentId,
      traceId: `profile-test-${newId()}`,
    };
  }

  function administratorSubject(
    overrides: Partial<AuthorisationSubject> = {},
  ): AuthorisationSubject {
    return {
      organisationId,
      actorId: actorIdA,
      capabilities: new Set(["agents.read", "agents.manage"]),
      ...overrides,
    };
  }

  function proposalPayload(
    label: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      displayName: `Synthetic Alfie ${label}`,
      description:
        "Researches approved sources and produces evidence-backed briefs.",
      role: "Security research and technology intelligence",
      operatingInstructions:
        `Research only organisation-approved sources. Cite every claim. Never take unapproved external action. Synthetic marker: ${label}.`,
      communicationStyle: "Concise, evidence-first, cites sources.",
      examplePrompts: ["Summarise the latest CISA advisories for our stack."],
      changeRationale: `Synthetic governed profile proposal for ${label}.`,
      ...overrides,
    };
  }

  async function proposeVersion(actorId: string, label: string) {
    const result = await mutateAgentProfile(context(actorId), {
      action: "propose_profile",
      proposal: proposalPayload(label),
    });
    if (
      !result ||
      typeof result !== "object" ||
      !("version" in result) ||
      !result.version ||
      typeof result.version !== "object" ||
      !("id" in result.version)
    ) {
      throw new Error("Expected proposed version");
    }
    return result.version as typeof schema.agentProfileVersions.$inferSelect;
  }

  async function evaluateVersion(actorId: string, versionId: string) {
    return mutateAgentProfile(context(actorId), {
      action: "evaluate_profile",
      versionId,
    }) as Promise<typeof schema.agentProfileEvaluations.$inferSelect>;
  }

  async function approveVersion(actorId: string, versionId: string) {
    return mutateAgentProfile(context(actorId), {
      action: "approve_profile",
      versionId,
    }) as Promise<typeof schema.agentProfileVersions.$inferSelect>;
  }

  async function activateVersion(actorId: string, versionId: string) {
    return mutateAgentProfile(context(actorId), {
      action: "activate_profile",
      versionId,
    }) as Promise<typeof schema.agentProfileVersions.$inferSelect>;
  }

  let versionOneId = "";
  let versionOneRunId = "";
  let versionTwoId = "";
  let selfApprovalDraftVersionId = "";

  it("proposes, evaluates, approves and activates a governed profile version", async () => {
    const proposed = await proposeVersion(actorIdA, "happy-path");
    expect(proposed.state).toBe("draft");
    expect(proposed.createdByActorId).toBe(actorIdA);
    versionOneId = proposed.id;

    const evaluation = await evaluateVersion(actorIdA, versionOneId);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.score).toBe(100);

    const approved = await approveVersion(actorIdB, versionOneId);
    expect(approved.state).toBe("approved");
    expect(approved.approvedByActorId).toBe(actorIdB);

    const activated = await activateVersion(actorIdA, versionOneId);
    expect(activated.state).toBe("active");

    const state = await agentProfileState(administratorSubject(), agentId);
    expect(state.activeProfile).toMatchObject({ id: versionOneId });

    // Captured now (before the rollback/retirement churn in later tests) so
    // a later assertion can prove historical runs remain explainable after
    // the profile that produced them is superseded.
    versionOneRunId = newId();
    const source = await database()
      .select()
      .from(schema.agentDefinitions)
      .where(eq(schema.agentDefinitions.id, agentId));
    const definition = source[0];
    if (!definition) throw new Error("Agent definition missing");
    await database()
      .insert(schema.agentRuns)
      .values({
        id: versionOneRunId,
        organisationId,
        agentId,
        requestedByActorId: actorIdA,
        trigger: "profile_integration_test",
        status: "completed",
        request: { traceId: `profile-run-${versionOneRunId}` },
        progress: { stage: "completed", percent: 100 },
        startedAt: new Date(),
        completedAt: new Date(),
        inputHash: createHash("sha256").update(versionOneRunId).digest("hex"),
        outputHash: createHash("sha256")
          .update(`output:${versionOneRunId}`)
          .digest("hex"),
        promptVersion: definition.systemPromptVersion,
        runtime: "mock",
        model: definition.model,
        maximumRuntimeSeconds: definition.maximumRuntimeSeconds,
        maximumTokenBudget: definition.maximumTokenBudget,
        maximumCostCents: definition.maximumCostCents,
        idempotencyKey: `profile-run:${versionOneRunId}`,
        agentProfileVersionId: versionOneId,
      });
  });

  it("rejects self-approval at the application layer and the database layer", async () => {
    const proposed = await proposeVersion(actorIdA, "self-approval");
    selfApprovalDraftVersionId = proposed.id;
    await evaluateVersion(actorIdA, selfApprovalDraftVersionId);

    await expect(
      mutateAgentProfile(context(actorIdA), {
        action: "approve_profile",
        versionId: selfApprovalDraftVersionId,
      }),
    ).rejects.toThrow("Approver cannot be the actor who proposed the change");

    // Prove the guard is not purely application-layer: attempting the same
    // illegal transition directly against the database must also fail with
    // a Postgres check-constraint violation, not just the domain error.
    let dbLevelError: unknown;
    try {
      await database()
        .update(schema.agentProfileVersions)
        .set({ approvedByActorId: actorIdA, state: "approved" })
        .where(eq(schema.agentProfileVersions.id, selfApprovalDraftVersionId));
    } catch (error) {
      dbLevelError = error;
    }
    expect(dbLevelError).toBeInstanceOf(Error);
    const dbLevelCause =
      dbLevelError instanceof Error && dbLevelError.cause instanceof Error
        ? dbLevelError.cause
        : dbLevelError;
    expect(String(dbLevelCause)).toMatch(/self_approval_check/);

    const [record] = await database()
      .select()
      .from(schema.agentProfileVersions)
      .where(eq(schema.agentProfileVersions.id, selfApprovalDraftVersionId));
    expect(record?.state).toBe("draft");
    expect(record?.approvedByActorId).toBeNull();
  });

  it("requires the approved state before activation", async () => {
    const draft = await proposeVersion(actorIdA, "activate-requires-approved");
    expect(draft.state).toBe("draft");
    await expect(
      mutateAgentProfile(context(actorIdA), {
        action: "activate_profile",
        versionId: draft.id,
      }),
    ).rejects.toThrow("Profile version must be approved before activation");

    // Clean this draft up via retirement so it doesn't linger as an
    // orphaned draft for the remainder of the suite.
    await mutateAgentProfile(context(actorIdA), {
      action: "retire_profile",
      versionId: draft.id,
    });
  });

  it("keeps exactly one active profile version per agent", async () => {
    const proposed = await proposeVersion(actorIdA, "second-version");
    versionTwoId = proposed.id;
    expect(proposed.basedOnVersionId).toBe(versionOneId);

    await evaluateVersion(actorIdA, versionTwoId);
    await approveVersion(actorIdB, versionTwoId);
    const activated = await activateVersion(actorIdA, versionTwoId);
    expect(activated.state).toBe("active");

    const [supersededVersionOne] = await database()
      .select()
      .from(schema.agentProfileVersions)
      .where(eq(schema.agentProfileVersions.id, versionOneId));
    expect(supersededVersionOne?.state).toBe("retired");

    const [activeCount] = await database()
      .select({ value: count() })
      .from(schema.agentProfileVersions)
      .where(
        and(
          eq(schema.agentProfileVersions.organisationId, organisationId),
          eq(schema.agentProfileVersions.agentId, agentId),
          eq(schema.agentProfileVersions.state, "active"),
        ),
      );
    expect(activeCount?.value).toBe(1);
  });

  it("rolls back to the immediate predecessor version", async () => {
    const rollback = await mutateAgentProfile(context(actorIdA), {
      action: "rollback_profile",
      versionId: versionTwoId,
    });
    expect(rollback).toMatchObject({
      versionId: versionTwoId,
      restoredVersionId: versionOneId,
    });

    const [rolledBack] = await database()
      .select()
      .from(schema.agentProfileVersions)
      .where(eq(schema.agentProfileVersions.id, versionTwoId));
    expect(rolledBack?.state).toBe("retired");

    const [restored] = await database()
      .select()
      .from(schema.agentProfileVersions)
      .where(eq(schema.agentProfileVersions.id, versionOneId));
    expect(restored?.state).toBe("active");

    const [definition] = await database()
      .select({
        activeProfileVersionId: schema.agentDefinitions.activeProfileVersionId,
      })
      .from(schema.agentDefinitions)
      .where(eq(schema.agentDefinitions.id, agentId));
    expect(definition?.activeProfileVersionId).toBe(versionOneId);
  });

  it("keeps historical run attribution explainable after later profile changes", async () => {
    const [run] = await database()
      .select({
        id: schema.agentRuns.id,
        agentProfileVersionId: schema.agentRuns.agentProfileVersionId,
      })
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, versionOneRunId));
    expect(run?.agentProfileVersionId).toBe(versionOneId);

    const [joined] = await database()
      .select({
        runId: schema.agentRuns.id,
        role: schema.agentProfileVersions.role,
        operatingInstructions: schema.agentProfileVersions.operatingInstructions,
      })
      .from(schema.agentRuns)
      .innerJoin(
        schema.agentProfileVersions,
        eq(schema.agentRuns.agentProfileVersionId, schema.agentProfileVersions.id),
      )
      .where(eq(schema.agentRuns.id, versionOneRunId));
    expect(joined).toMatchObject({
      runId: versionOneRunId,
      role: "Security research and technology intelligence",
      operatingInstructions: expect.stringContaining(
        "Synthetic marker: happy-path.",
      ),
    });
  });

  it("blocks retiring the active version but allows retiring a non-active one", async () => {
    await expect(
      mutateAgentProfile(context(actorIdA), {
        action: "retire_profile",
        versionId: versionOneId,
      }),
    ).rejects.toThrow(
      "Roll back or activate a replacement before retiring the active profile version",
    );

    const retired = await mutateAgentProfile(context(actorIdA), {
      action: "retire_profile",
      versionId: selfApprovalDraftVersionId,
    });
    expect(retired).toMatchObject({
      id: selfApprovalDraftVersionId,
      state: "retired",
    });

    const [record] = await database()
      .select()
      .from(schema.agentProfileVersions)
      .where(eq(schema.agentProfileVersions.id, selfApprovalDraftVersionId));
    expect(record?.state).toBe("retired");
  });

  it("isolates profile mutations and reads across organisations", async () => {
    const foreignOrganisationId = newId();
    await expect(
      mutateAgentProfile(
        { organisationId: foreignOrganisationId, actorId: actorIdA, agentId, traceId: newId() },
        { action: "propose_profile", proposal: proposalPayload("cross-tenant") },
      ),
    ).rejects.toThrow("not found");

    await expect(
      agentProfileState(
        administratorSubject({ organisationId: foreignOrganisationId }),
        agentId,
      ),
    ).rejects.toThrow("not found");
  });

  it("creates and versions agent policies", async () => {
    const first = await mutateAgentProfile(context(actorIdA), {
      action: "create_policy",
      kind: "model",
      name: "Synthetic model policy",
      document: { model: "test" },
    });
    if (
      !first ||
      typeof first !== "object" ||
      !("version" in first) ||
      !("state" in first)
    ) {
      throw new Error("Expected created policy");
    }
    expect(first.state).toBe("active");
    expect(first.version as number).toBeGreaterThan(0);

    const second = await mutateAgentProfile(context(actorIdA), {
      action: "create_policy",
      kind: "model",
      name: "Synthetic model policy v2",
      document: { model: "test-2" },
    });
    if (!second || typeof second !== "object" || !("version" in second)) {
      throw new Error("Expected created policy");
    }
    expect(second.version as number).toBe((first.version as number) + 1);
  });
});
