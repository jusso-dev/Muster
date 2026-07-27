import {
  AgentChannelPolicySchema,
  AgentProfileProposalSchema,
  evaluateProfileProposal,
  mayActivateProfile,
  mayApproveProfile,
  prepareProfileProposal,
} from "@muster/agents";
import { hasCapability, type AuthorisationSubject } from "@muster/authz";
import { redactObservationText } from "@muster/config";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import { and, desc, eq, max } from "drizzle-orm";
import { z } from "zod";

const ProfileMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("propose_profile"),
    proposal: AgentProfileProposalSchema,
  }),
  z.object({
    action: z.enum([
      "evaluate_profile",
      "approve_profile",
      "activate_profile",
      "reject_profile",
      "rollback_profile",
      "retire_profile",
    ]),
    versionId: z.uuid(),
    reason: z.string().trim().min(3).max(2_000).optional(),
  }),
  z.object({
    action: z.literal("create_policy"),
    kind: z.enum(["model", "memory", "tool", "escalation"]),
    name: z.string().min(2).max(160),
    document: z.record(z.string(), z.unknown()),
  }),
]);

export type ProfileMutation = z.infer<typeof ProfileMutationSchema>;

type ProfileContext = {
  organisationId: string;
  actorId: string;
  agentId: string;
  traceId: string;
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function requireAgent(organisationId: string, agentId: string) {
  const [definition] = await database()
    .select()
    .from(schema.agentDefinitions)
    .where(
      and(
        eq(schema.agentDefinitions.id, agentId),
        eq(schema.agentDefinitions.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!definition) throw new Error("Agent not found in organisation");
  return definition;
}

/**
 * Returns the governed profile state for an agent. Non-administrators
 * (missing `agents.manage`) only ever see the active version's public
 * fields, never drafts, operating instructions or policy internals — the
 * "advanced configuration" boundary is enforced server-side, not just by
 * hiding UI.
 */
export async function agentProfileState(
  subject: AuthorisationSubject,
  agentId: string,
) {
  const db = database();
  const definition = await requireAgent(subject.organisationId, agentId);
  const isAdministrator = hasCapability(subject, "agents.manage");

  const [versionRows, policyRows, recentRuns, readiness] = await Promise.all([
    db
      .select()
      .from(schema.agentProfileVersions)
      .where(
        and(
          eq(schema.agentProfileVersions.organisationId, subject.organisationId),
          eq(schema.agentProfileVersions.agentId, agentId),
        ),
      )
      .orderBy(desc(schema.agentProfileVersions.version)),
    db
      .select()
      .from(schema.agentPolicies)
      .where(
        and(
          eq(schema.agentPolicies.organisationId, subject.organisationId),
          eq(schema.agentPolicies.agentId, agentId),
        ),
      )
      .orderBy(desc(schema.agentPolicies.createdAt)),
    db
      .select({
        id: schema.agentRuns.id,
        roomId: schema.agentRuns.roomId,
        status: schema.agentRuns.status,
        trigger: schema.agentRuns.trigger,
        startedAt: schema.agentRuns.startedAt,
        completedAt: schema.agentRuns.completedAt,
        agentProfileVersionId: schema.agentRuns.agentProfileVersionId,
      })
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.organisationId, subject.organisationId),
          eq(schema.agentRuns.agentId, agentId),
        ),
      )
      .orderBy(desc(schema.agentRuns.startedAt))
      .limit(10),
    db
      .select()
      .from(schema.agentReadinessSnapshots)
      .where(
        and(
          eq(schema.agentReadinessSnapshots.organisationId, subject.organisationId),
          eq(schema.agentReadinessSnapshots.agentId, agentId),
        ),
      )
      .orderBy(desc(schema.agentReadinessSnapshots.verifiedAt))
      .limit(1),
  ]);

  const evaluations = versionRows.length
    ? await db
        .select()
        .from(schema.agentProfileEvaluations)
        .where(
          eq(schema.agentProfileEvaluations.organisationId, subject.organisationId),
        )
        .orderBy(desc(schema.agentProfileEvaluations.createdAt))
    : [];
  const approvals = await db
    .select()
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.organisationId, subject.organisationId),
        eq(schema.approvals.actionType, "agent.profile.approve"),
      ),
    )
    .orderBy(desc(schema.approvals.requestedAt));

  const activeVersion = versionRows.find((version) => version.state === "active");
  const available = !definition.killSwitch && definition.status === "active";

  const versions = versionRows.map((version) => ({
    ...version,
    evaluation:
      evaluations.find((evaluation) => evaluation.profileVersionId === version.id) ??
      null,
    approval:
      approvals.find((approval) => {
        const target =
          approval.target && typeof approval.target === "object"
            ? (approval.target as Record<string, unknown>)
            : {};
        return target.profileVersionId === version.id;
      }) ?? null,
  }));

  if (!isAdministrator) {
    return {
      agent: {
        id: definition.id,
        name: definition.name,
        available,
      },
      activeProfile: activeVersion
        ? {
            displayName: activeVersion.displayName,
            description: activeVersion.description,
            avatarAssetId: activeVersion.avatarAssetId,
            role: activeVersion.role,
            communicationStyle: activeVersion.communicationStyle,
            examplePrompts: strings(activeVersion.examplePrompts),
            version: activeVersion.version,
          }
        : null,
      recentRoomWork: recentRuns
        .filter((run) => run.roomId)
        .map((run) => ({
          roomId: run.roomId,
          status: run.status,
          trigger: run.trigger,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
        })),
    };
  }

  return {
    agent: {
      id: definition.id,
      name: definition.name,
      killSwitch: definition.killSwitch,
      status: definition.status,
      available,
      readiness: readiness[0] ?? null,
    },
    activeProfile: activeVersion ?? null,
    versions,
    policies: policyRows,
    recentRuns,
  };
}

export async function mutateAgentProfile(
  context: ProfileContext,
  input: unknown,
) {
  const mutation = ProfileMutationSchema.parse(input);
  switch (mutation.action) {
    case "propose_profile":
      return proposeProfile(context, mutation);
    case "evaluate_profile":
      return evaluateProfile(context, mutation.versionId);
    case "approve_profile":
      return approveProfile(context, mutation.versionId, mutation.reason);
    case "activate_profile":
      return activateProfile(context, mutation.versionId, mutation.reason);
    case "reject_profile":
      return rejectProfile(context, mutation.versionId, mutation.reason);
    case "rollback_profile":
      return rollbackProfile(context, mutation.versionId, mutation.reason);
    case "retire_profile":
      return retireProfile(context, mutation.versionId, mutation.reason);
    case "create_policy":
      return createPolicy(context, mutation);
  }
}

async function assertPolicyBelongsToAgent(
  context: ProfileContext,
  policyId: string | null,
) {
  if (!policyId) return;
  const [policy] = await database()
    .select({ id: schema.agentPolicies.id })
    .from(schema.agentPolicies)
    .where(
      and(
        eq(schema.agentPolicies.id, policyId),
        eq(schema.agentPolicies.organisationId, context.organisationId),
        eq(schema.agentPolicies.agentId, context.agentId),
      ),
    )
    .limit(1);
  if (!policy) throw new Error("Referenced policy not found for this agent");
}

async function assertSkillsBelongToAgent(
  context: ProfileContext,
  skillIds: readonly string[],
) {
  if (skillIds.length === 0) return;
  const rows = await database()
    .select({ id: schema.agentSkills.id })
    .from(schema.agentSkills)
    .where(
      and(
        eq(schema.agentSkills.organisationId, context.organisationId),
        eq(schema.agentSkills.agentId, context.agentId),
      ),
    );
  const known = new Set(rows.map((row) => row.id));
  for (const skillId of skillIds) {
    if (!known.has(skillId)) {
      throw new Error(`Skill ${skillId} not found for this agent`);
    }
  }
}

async function proposeProfile(
  context: ProfileContext,
  mutation: Extract<ProfileMutation, { action: "propose_profile" }>,
) {
  await requireAgent(context.organisationId, context.agentId);
  const proposal = prepareProfileProposal(mutation.proposal);
  await assertPolicyBelongsToAgent(context, proposal.modelPolicyId);
  await assertPolicyBelongsToAgent(context, proposal.memoryPolicyId);
  await assertPolicyBelongsToAgent(context, proposal.toolPolicyId);
  await assertPolicyBelongsToAgent(context, proposal.escalationPolicyId);
  await assertSkillsBelongToAgent(context, proposal.skillIds);
  const channelPolicy = AgentChannelPolicySchema.parse(proposal.channelPolicy);

  return database().transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: max(schema.agentProfileVersions.version) })
      .from(schema.agentProfileVersions)
      .where(eq(schema.agentProfileVersions.agentId, context.agentId));
    const [current] = await tx
      .select({ id: schema.agentProfileVersions.id })
      .from(schema.agentProfileVersions)
      .where(
        and(
          eq(schema.agentProfileVersions.agentId, context.agentId),
          eq(schema.agentProfileVersions.state, "active"),
        ),
      )
      .limit(1);
    const versionId = newId();
    const versionNumber = (latest?.version ?? 0) + 1;
    const [version] = await tx
      .insert(schema.agentProfileVersions)
      .values({
        id: versionId,
        organisationId: context.organisationId,
        agentId: context.agentId,
        version: versionNumber,
        basedOnVersionId: current?.id ?? null,
        displayName: proposal.displayName,
        description: proposal.description,
        avatarAssetId: proposal.avatarAssetId,
        role: proposal.role,
        operatingInstructions: proposal.operatingInstructions,
        communicationStyle: proposal.communicationStyle,
        examplePrompts: proposal.examplePrompts,
        modelPolicyId: proposal.modelPolicyId,
        memoryPolicyId: proposal.memoryPolicyId,
        toolPolicyId: proposal.toolPolicyId,
        escalationPolicyId: proposal.escalationPolicyId,
        skillIds: proposal.skillIds,
        channelPolicy,
        contentHash: proposal.contentHash,
        changeRationale: proposal.changeRationale,
        state: "draft",
        createdByActorId: context.actorId,
      })
      .returning();
    const approvalId = newId();
    await tx.insert(schema.approvals).values({
      id: approvalId,
      organisationId: context.organisationId,
      requestingActorId: context.actorId,
      actionType: "agent.profile.approve",
      target: { agentId: context.agentId, profileVersionId: versionId },
      riskSummary:
        "Activating a new profile version changes the agent's governed identity, instructions and policies. Evaluation and a distinct human approval are required.",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      requiredCapability: "agents.manage",
      requiredApprovalCount: 1,
      idempotencyKey: `agent.profile.approve:${versionId}`,
    });
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: "agent.profile.proposed",
      targetType: "agent_profile_version",
      targetId: versionId,
      metadata: { contentHash: proposal.contentHash, approvalId },
      traceId: context.traceId,
    });
    await writeOutbox(tx, {
      organisationId: context.organisationId,
      eventType: "agent.profile.proposed",
      aggregateType: "agent_profile_version",
      aggregateId: versionId,
      queueName: "muster-agents",
      payload: { agentId: context.agentId, approvalId },
      idempotencyKey: `agent.profile.proposed:${versionId}`,
      traceId: context.traceId,
    });
    return { version, approvalId };
  });
}

async function versionContext(context: ProfileContext, versionId: string) {
  const [record] = await database()
    .select()
    .from(schema.agentProfileVersions)
    .where(
      and(
        eq(schema.agentProfileVersions.id, versionId),
        eq(schema.agentProfileVersions.organisationId, context.organisationId),
        eq(schema.agentProfileVersions.agentId, context.agentId),
      ),
    )
    .limit(1);
  if (!record) throw new Error("Profile version not found in organisation");
  return record;
}

async function approvalForVersion(context: ProfileContext, versionId: string) {
  const approvals = await database()
    .select()
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.organisationId, context.organisationId),
        eq(schema.approvals.actionType, "agent.profile.approve"),
      ),
    );
  return approvals.find((approval) => {
    const target =
      approval.target && typeof approval.target === "object"
        ? (approval.target as Record<string, unknown>)
        : {};
    return target.profileVersionId === versionId;
  });
}

async function evaluateProfile(context: ProfileContext, versionId: string) {
  const record = await versionContext(context, versionId);
  let baselineScore: number | undefined;
  if (record.basedOnVersionId) {
    const [baseline] = await database()
      .select({ score: schema.agentProfileEvaluations.score })
      .from(schema.agentProfileEvaluations)
      .where(
        and(
          eq(schema.agentProfileEvaluations.organisationId, context.organisationId),
          eq(schema.agentProfileEvaluations.profileVersionId, record.basedOnVersionId),
        ),
      )
      .orderBy(desc(schema.agentProfileEvaluations.createdAt))
      .limit(1);
    baselineScore = baseline?.score;
  }
  const evaluation = evaluateProfileProposal(
    {
      displayName: record.displayName,
      description: record.description,
      avatarAssetId: record.avatarAssetId,
      role: record.role,
      operatingInstructions: record.operatingInstructions,
      communicationStyle: record.communicationStyle,
      examplePrompts: strings(record.examplePrompts),
      modelPolicyId: record.modelPolicyId,
      memoryPolicyId: record.memoryPolicyId,
      toolPolicyId: record.toolPolicyId,
      escalationPolicyId: record.escalationPolicyId,
      skillIds: strings(record.skillIds),
      channelPolicy: record.channelPolicy,
      changeRationale: record.changeRationale,
    },
    baselineScore !== undefined ? { baselineScore } : {},
  );
  return database().transaction(async (tx) => {
    const [saved] = await tx
      .insert(schema.agentProfileEvaluations)
      .values({
        id: newId(),
        organisationId: context.organisationId,
        profileVersionId: versionId,
        evaluatorActorId: context.actorId,
        suite: evaluation.suite,
        passed: evaluation.passed,
        score: evaluation.score,
        baselineScore: evaluation.baselineScore,
        regressions: evaluation.regressions,
        result: { diagnostics: evaluation.diagnostics },
      })
      .returning();
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: "agent.profile.evaluated",
      targetType: "agent_profile_version",
      targetId: versionId,
      metadata: {
        passed: evaluation.passed,
        score: evaluation.score,
        regressions: evaluation.regressions,
      },
      traceId: context.traceId,
    });
    return saved;
  });
}

async function approveProfile(
  context: ProfileContext,
  versionId: string,
  reason = "Evaluation passed and approved by a distinct reviewer",
) {
  const record = await versionContext(context, versionId);
  if (record.state !== "draft") {
    throw new Error("Only a draft profile version can be approved");
  }
  const [evaluation] = await database()
    .select()
    .from(schema.agentProfileEvaluations)
    .where(
      and(
        eq(schema.agentProfileEvaluations.organisationId, context.organisationId),
        eq(schema.agentProfileEvaluations.profileVersionId, versionId),
      ),
    )
    .orderBy(desc(schema.agentProfileEvaluations.createdAt))
    .limit(1);
  const approval = await approvalForVersion(context, versionId);
  if (!evaluation || !approval || approval.status !== "pending") {
    throw new Error("Pending approval and completed evaluation are required");
  }
  const decision = mayApproveProfile(
    {
      passed: evaluation.passed,
      score: evaluation.score,
      ...(evaluation.baselineScore !== null
        ? { baselineScore: evaluation.baselineScore }
        : {}),
      regressions: strings(evaluation.regressions),
    },
    record.createdByActorId,
    context.actorId,
  );
  if (!decision.allowed) throw new Error(decision.reasons.join("; "));
  const now = new Date();
  return database().transaction(async (tx) => {
    const [approved] = await tx
      .update(schema.agentProfileVersions)
      .set({
        state: "approved",
        approvedByActorId: context.actorId,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.agentProfileVersions.id, versionId))
      .returning();
    await tx
      .update(schema.approvals)
      .set({
        status: "approved",
        decisions: [
          {
            actorId: context.actorId,
            decision: "approved",
            reason,
            decidedAt: now.toISOString(),
          },
        ],
        decisionAt: now,
        reason,
        executedAt: now,
      })
      .where(eq(schema.approvals.id, approval.id));
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: "agent.profile.approved",
      targetType: "agent_profile_version",
      targetId: versionId,
      metadata: { approvalId: approval.id, reason },
      traceId: context.traceId,
    });
    return approved;
  });
}

async function activateProfile(
  context: ProfileContext,
  versionId: string,
  reason = "Activated by administrator",
) {
  const record = await versionContext(context, versionId);
  const decision = mayActivateProfile(record.state);
  if (!decision.allowed) throw new Error(decision.reasons.join("; "));
  const now = new Date();
  return database().transaction(async (tx) => {
    const [previouslyActive] = await tx
      .select({ id: schema.agentProfileVersions.id })
      .from(schema.agentProfileVersions)
      .where(
        and(
          eq(schema.agentProfileVersions.agentId, context.agentId),
          eq(schema.agentProfileVersions.organisationId, context.organisationId),
          eq(schema.agentProfileVersions.state, "active"),
        ),
      )
      .limit(1);
    if (previouslyActive) {
      await tx
        .update(schema.agentProfileVersions)
        .set({ state: "retired", retiredAt: now, updatedAt: now })
        .where(eq(schema.agentProfileVersions.id, previouslyActive.id));
    }
    const [activated] = await tx
      .update(schema.agentProfileVersions)
      .set({ state: "active", activatedAt: now, updatedAt: now })
      .where(eq(schema.agentProfileVersions.id, versionId))
      .returning();
    await tx
      .update(schema.agentDefinitions)
      .set({ activeProfileVersionId: versionId, updatedAt: now })
      .where(
        and(
          eq(schema.agentDefinitions.id, context.agentId),
          eq(schema.agentDefinitions.organisationId, context.organisationId),
        ),
      );
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: "agent.profile.activated",
      targetType: "agent_profile_version",
      targetId: versionId,
      metadata: {
        reason,
        supersededVersionId: previouslyActive?.id ?? null,
      },
      traceId: context.traceId,
    });
    await writeOutbox(tx, {
      organisationId: context.organisationId,
      eventType: "agent.profile.activated",
      aggregateType: "agent_profile_version",
      aggregateId: versionId,
      queueName: "muster-agents",
      payload: { agentId: context.agentId },
      idempotencyKey: `agent.profile.activated:${versionId}`,
      traceId: context.traceId,
    });
    return activated;
  });
}

async function rejectProfile(
  context: ProfileContext,
  versionId: string,
  reason = "Rejected by human reviewer",
) {
  const record = await versionContext(context, versionId);
  if (record.state !== "draft") {
    throw new Error("Only a draft profile version can be rejected");
  }
  const approval = await approvalForVersion(context, versionId);
  return database().transaction(async (tx) => {
    await tx
      .update(schema.agentProfileVersions)
      .set({ state: "retired", retiredAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.agentProfileVersions.id, versionId));
    if (approval) {
      await tx
        .update(schema.approvals)
        .set({
          status: "rejected",
          decisions: [
            {
              actorId: context.actorId,
              decision: "rejected",
              reason,
              decidedAt: new Date().toISOString(),
            },
          ],
          decisionAt: new Date(),
          reason,
        })
        .where(eq(schema.approvals.id, approval.id));
    }
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: "agent.profile.rejected",
      targetType: "agent_profile_version",
      targetId: versionId,
      metadata: { reason },
      traceId: context.traceId,
    });
    return { versionId, state: "retired" as const };
  });
}

async function rollbackProfile(
  context: ProfileContext,
  versionId: string,
  reason = "Rolled back by administrator",
) {
  const record = await versionContext(context, versionId);
  if (record.state !== "active" || !record.basedOnVersionId) {
    throw new Error("Only an active version with a predecessor can roll back");
  }
  const previousId = record.basedOnVersionId;
  const now = new Date();
  return database().transaction(async (tx) => {
    await tx
      .update(schema.agentProfileVersions)
      .set({ state: "retired", retiredAt: now, updatedAt: now })
      .where(eq(schema.agentProfileVersions.id, versionId));
    const [restored] = await tx
      .update(schema.agentProfileVersions)
      .set({ state: "active", activatedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.agentProfileVersions.id, previousId),
          eq(schema.agentProfileVersions.organisationId, context.organisationId),
        ),
      )
      .returning();
    if (!restored) throw new Error("Predecessor profile version not found");
    await tx
      .update(schema.agentDefinitions)
      .set({ activeProfileVersionId: previousId, updatedAt: now })
      .where(
        and(
          eq(schema.agentDefinitions.id, context.agentId),
          eq(schema.agentDefinitions.organisationId, context.organisationId),
        ),
      );
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: "agent.profile.rolled_back",
      targetType: "agent_profile_version",
      targetId: versionId,
      metadata: { restoredVersionId: previousId, reason: redactObservationText(reason) },
      traceId: context.traceId,
    });
    await writeOutbox(tx, {
      organisationId: context.organisationId,
      eventType: "agent.profile.rolled_back",
      aggregateType: "agent_profile_version",
      aggregateId: versionId,
      queueName: "muster-agents",
      payload: { agentId: context.agentId, restoredVersionId: previousId },
      idempotencyKey: `agent.profile.rolled_back:${versionId}`,
      traceId: context.traceId,
    });
    return { versionId, restoredVersionId: previousId };
  });
}

async function retireProfile(
  context: ProfileContext,
  versionId: string,
  reason = "Retired by administrator",
) {
  const record = await versionContext(context, versionId);
  if (record.state === "active") {
    throw new Error(
      "Roll back or activate a replacement before retiring the active profile version",
    );
  }
  const now = new Date();
  return database().transaction(async (tx) => {
    const [retired] = await tx
      .update(schema.agentProfileVersions)
      .set({ state: "retired", retiredAt: now, updatedAt: now })
      .where(eq(schema.agentProfileVersions.id, versionId))
      .returning();
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: "agent.profile.retired",
      targetType: "agent_profile_version",
      targetId: versionId,
      metadata: { reason },
      traceId: context.traceId,
    });
    return retired;
  });
}

async function createPolicy(
  context: ProfileContext,
  mutation: Extract<ProfileMutation, { action: "create_policy" }>,
) {
  await requireAgent(context.organisationId, context.agentId);
  return database().transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: max(schema.agentPolicies.version) })
      .from(schema.agentPolicies)
      .where(
        and(
          eq(schema.agentPolicies.agentId, context.agentId),
          eq(schema.agentPolicies.kind, mutation.kind),
        ),
      );
    const id = newId();
    const [policy] = await tx
      .insert(schema.agentPolicies)
      .values({
        id,
        organisationId: context.organisationId,
        agentId: context.agentId,
        kind: mutation.kind,
        name: mutation.name,
        version: (latest?.version ?? 0) + 1,
        document: mutation.document,
        state: "active",
        createdByActorId: context.actorId,
      })
      .returning();
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: "agent.policy.created",
      targetType: "agent_policy",
      targetId: id,
      metadata: { kind: mutation.kind, name: mutation.name },
      traceId: context.traceId,
    });
    return policy;
  });
}
