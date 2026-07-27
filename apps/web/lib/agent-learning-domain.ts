import {
  AgentLearningNoteSchema,
  AgentSkillProposalSchema,
  evaluateSkillProposal,
  mayPublishSkill,
  prepareSkillProposal,
} from "@muster/agents";
import { redactObservationText } from "@muster/config";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import { and, desc, eq, gt, isNull, max, ne, or } from "drizzle-orm";
import { z } from "zod";

const LearningMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("note"),
    sourceRunId: z.string().uuid(),
    note: AgentLearningNoteSchema,
  }),
  z.object({
    action: z.literal("propose_skill"),
    sourceRunId: z.string().uuid(),
    proposal: AgentSkillProposalSchema,
  }),
  z.object({
    action: z.enum([
      "evaluate_skill",
      "publish_skill",
      "reject_skill",
      "rollback_skill",
      "retire_skill",
    ]),
    versionId: z.string().uuid(),
    reason: z.string().trim().min(3).max(2_000).optional(),
  }),
  z.object({
    action: z.literal("set_kill_switch"),
    enabled: z.boolean(),
    reason: z.string().trim().min(3).max(2_000),
  }),
]);

export type LearningMutation = z.infer<typeof LearningMutationSchema>;

type LearningContext = {
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

export async function agentLearningState(
  organisationId: string,
  agentId: string,
  options: { includeInactive?: boolean } = {},
) {
  const db = database();
  const memoryConditions = [
    eq(schema.agentMemories.organisationId, organisationId),
    eq(schema.agentMemories.agentId, agentId),
  ];
  if (!options.includeInactive) {
    const now = new Date();
    memoryConditions.push(ne(schema.agentMemories.status, "rejected"));
    const activeMemoryCondition = or(
      isNull(schema.agentMemories.expiresAt),
      gt(schema.agentMemories.expiresAt, now),
    );
    if (activeMemoryCondition) memoryConditions.push(activeMemoryCondition);
  }
  const [definition] = await db
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
  const [memories, skills, versionRows, evaluations, approvals] =
    await Promise.all([
      db
        .select()
        .from(schema.agentMemories)
        .where(and(...memoryConditions))
        .orderBy(desc(schema.agentMemories.createdAt))
        .limit(100),
      db
        .select()
        .from(schema.agentSkills)
        .where(
          and(
            eq(schema.agentSkills.organisationId, organisationId),
            eq(schema.agentSkills.agentId, agentId),
          ),
        )
        .orderBy(desc(schema.agentSkills.createdAt)),
      db
        .select({
          version: schema.agentSkillVersions,
          skillId: schema.agentSkills.id,
        })
        .from(schema.agentSkillVersions)
        .innerJoin(
          schema.agentSkills,
          and(
            eq(schema.agentSkills.id, schema.agentSkillVersions.skillId),
            eq(
              schema.agentSkills.organisationId,
              schema.agentSkillVersions.organisationId,
            ),
          ),
        )
        .where(
          and(
            eq(schema.agentSkillVersions.organisationId, organisationId),
            eq(schema.agentSkills.agentId, agentId),
          ),
        )
        .orderBy(desc(schema.agentSkillVersions.createdAt)),
      db
        .select()
        .from(schema.agentSkillEvaluations)
        .where(eq(schema.agentSkillEvaluations.organisationId, organisationId))
        .orderBy(desc(schema.agentSkillEvaluations.createdAt)),
      db
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.organisationId, organisationId),
            eq(schema.approvals.actionType, "agent.skill.publish"),
          ),
        )
        .orderBy(desc(schema.approvals.requestedAt)),
    ]);
  const versions = versionRows.map(({ version }) => ({
    ...version,
    evaluation:
      evaluations.find(
        (evaluation) => evaluation.skillVersionId === version.id,
      ) ?? null,
    approval:
      approvals.find((approval) => {
        const target =
          approval.target && typeof approval.target === "object"
            ? (approval.target as Record<string, unknown>)
            : {};
        return target.skillVersionId === version.id;
      }) ?? null,
  }));
  return {
    agent: {
      id: definition.id,
      name: definition.name,
      killSwitch: definition.killSwitch,
      allowedTools: strings(definition.allowedTools),
      capabilityRequirements: strings(definition.capabilityRequirements),
    },
    memories,
    skills: skills.map((skill) => ({
      ...skill,
      versions: versions.filter((version) => version.skillId === skill.id),
    })),
  };
}

export async function mutateAgentLearning(
  context: LearningContext,
  input: unknown,
) {
  const mutation = LearningMutationSchema.parse(input);
  switch (mutation.action) {
    case "note":
      return createLearningNote(context, mutation);
    case "propose_skill":
      return proposeSkill(context, mutation);
    case "evaluate_skill":
      return evaluateSkill(context, mutation.versionId);
    case "publish_skill":
      return publishSkill(context, mutation.versionId, mutation.reason);
    case "reject_skill":
      return rejectSkill(context, mutation.versionId, mutation.reason);
    case "rollback_skill":
      return rollbackSkill(context, mutation.versionId, mutation.reason);
    case "retire_skill":
      return retireSkill(context, mutation.versionId, mutation.reason);
    case "set_kill_switch":
      return setKillSwitch(context, mutation.enabled, mutation.reason);
  }
}

async function sourceRun(context: LearningContext, sourceRunId: string) {
  const [run] = await database()
    .select()
    .from(schema.agentRuns)
    .where(
      and(
        eq(schema.agentRuns.id, sourceRunId),
        eq(schema.agentRuns.organisationId, context.organisationId),
        eq(schema.agentRuns.agentId, context.agentId),
      ),
    )
    .limit(1);
  if (!run || !["completed", "failed", "cancelled"].includes(run.status)) {
    throw new Error("Learning requires a terminal run from this agent");
  }
  return run;
}

async function createLearningNote(
  context: LearningContext,
  mutation: Extract<LearningMutation, { action: "note" }>,
) {
  await sourceRun(context, mutation.sourceRunId);
  const [definition] = await database()
    .select({ name: schema.agentDefinitions.name })
    .from(schema.agentDefinitions)
    .where(
      and(
        eq(schema.agentDefinitions.organisationId, context.organisationId),
        eq(schema.agentDefinitions.id, context.agentId),
      ),
    )
    .limit(1);
  if (definition?.name === "Parker" && mutation.note.kind !== "preference") {
    throw new Error(
      "Parker learning is limited to reviewed reporting preferences.",
    );
  }
  const id = newId();
  return database().transaction(async (tx) => {
    const [note] = await tx
      .insert(schema.agentMemories)
      .values({
        id,
        organisationId: context.organisationId,
        agentId: context.agentId,
        sourceRunId: mutation.sourceRunId,
        ...mutation.note,
        expiresAt: mutation.note.expiresAt
          ? new Date(mutation.note.expiresAt)
          : null,
        reviewedByActorId: context.actorId,
        reviewedAt: new Date(),
      })
      .returning();
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: "agent.learning_note.created",
      targetType: "agent_memory",
      targetId: id,
      metadata: { sourceRunId: mutation.sourceRunId },
      traceId: context.traceId,
    });
    await writeOutbox(tx, {
      organisationId: context.organisationId,
      eventType: "agent.learning_note.created",
      aggregateType: "agent_memory",
      aggregateId: id,
      queueName: "muster-agents",
      payload: { agentId: context.agentId, sourceRunId: mutation.sourceRunId },
      idempotencyKey: `agent.learning-note:${id}`,
      traceId: context.traceId,
    });
    return note;
  });
}

async function proposeSkill(
  context: LearningContext,
  mutation: Extract<LearningMutation, { action: "propose_skill" }>,
) {
  const run = await sourceRun(context, mutation.sourceRunId);
  if (run.status !== "completed") {
    throw new Error("Skill proposals require a completed source run");
  }
  const proposal = prepareSkillProposal(mutation.proposal);
  return database().transaction(async (tx) => {
    let [skill] = await tx
      .select()
      .from(schema.agentSkills)
      .where(
        and(
          eq(schema.agentSkills.organisationId, context.organisationId),
          eq(schema.agentSkills.agentId, context.agentId),
          eq(schema.agentSkills.skillKey, proposal.skillKey),
        ),
      )
      .limit(1);
    if (!skill) {
      [skill] = await tx
        .insert(schema.agentSkills)
        .values({
          id: newId(),
          organisationId: context.organisationId,
          agentId: context.agentId,
          skillKey: proposal.skillKey,
          name: proposal.name,
          description: proposal.description,
          status: "draft",
          createdByActorId: run.agentId,
        })
        .returning();
    }
    if (!skill) throw new Error("Could not create skill");
    const [latest] = await tx
      .select({ version: max(schema.agentSkillVersions.version) })
      .from(schema.agentSkillVersions)
      .where(eq(schema.agentSkillVersions.skillId, skill.id));
    const versionId = newId();
    const versionNumber = (latest?.version ?? 0) + 1;
    const [version] = await tx
      .insert(schema.agentSkillVersions)
      .values({
        id: versionId,
        organisationId: context.organisationId,
        skillId: skill.id,
        version: versionNumber,
        sourceRunId: mutation.sourceRunId,
        basedOnVersionId: skill.activeVersionId,
        content: proposal.content,
        contentHash: proposal.contentHash,
        changeRationale: proposal.changeRationale,
        evidenceReferences: proposal.evidenceReferences,
        requiredCapabilities: proposal.requiredCapabilities,
        allowedTools: proposal.allowedTools,
        state: proposal.state,
      })
      .returning();
    const approvalId = newId();
    await tx.insert(schema.approvals).values({
      id: approvalId,
      organisationId: context.organisationId,
      requestingActorId: run.agentId,
      actionType: "agent.skill.publish",
      target: {
        agentId: context.agentId,
        skillId: skill.id,
        skillVersionId: versionId,
      },
      riskSummary:
        "Publishing changes trusted agent instructions. Evaluation and an explicit human decision are required.",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      requiredCapability: "agents.manage",
      requiredApprovalCount: 1,
      idempotencyKey: `agent.skill.publish:${versionId}`,
    });
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: run.agentId,
      actorType: "agent",
      action: "agent.skill.proposed",
      targetType: "agent_skill_version",
      targetId: versionId,
      metadata: {
        sourceRunId: run.id,
        contentHash: proposal.contentHash,
        approvalId,
      },
      traceId: context.traceId,
    });
    await writeOutbox(tx, {
      organisationId: context.organisationId,
      eventType: "agent.skill.proposed",
      aggregateType: "agent_skill_version",
      aggregateId: versionId,
      queueName: "muster-agents",
      payload: { agentId: context.agentId, skillId: skill.id, approvalId },
      idempotencyKey: `agent.skill.proposed:${versionId}`,
      traceId: context.traceId,
    });
    return { skill, version, approvalId };
  });
}

async function versionContext(context: LearningContext, versionId: string) {
  const [record] = await database()
    .select({
      version: schema.agentSkillVersions,
      skill: schema.agentSkills,
      definition: schema.agentDefinitions,
    })
    .from(schema.agentSkillVersions)
    .innerJoin(
      schema.agentSkills,
      and(
        eq(schema.agentSkills.id, schema.agentSkillVersions.skillId),
        eq(
          schema.agentSkills.organisationId,
          schema.agentSkillVersions.organisationId,
        ),
      ),
    )
    .innerJoin(
      schema.agentDefinitions,
      and(
        eq(schema.agentDefinitions.id, schema.agentSkills.agentId),
        eq(
          schema.agentDefinitions.organisationId,
          schema.agentSkills.organisationId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.agentSkillVersions.id, versionId),
        eq(schema.agentSkillVersions.organisationId, context.organisationId),
        eq(schema.agentSkills.agentId, context.agentId),
      ),
    )
    .limit(1);
  if (!record) throw new Error("Skill version not found in organisation");
  return record;
}

async function evaluateSkill(context: LearningContext, versionId: string) {
  const record = await versionContext(context, versionId);
  let baselineScore: number | undefined;
  if (record.version.basedOnVersionId) {
    const [baseline] = await database()
      .select({ score: schema.agentSkillEvaluations.score })
      .from(schema.agentSkillEvaluations)
      .where(
        and(
          eq(
            schema.agentSkillEvaluations.organisationId,
            context.organisationId,
          ),
          eq(
            schema.agentSkillEvaluations.skillVersionId,
            record.version.basedOnVersionId,
          ),
        ),
      )
      .orderBy(desc(schema.agentSkillEvaluations.createdAt))
      .limit(1);
    baselineScore = baseline?.score;
  }
  const evaluation = evaluateSkillProposal(
    {
      skillKey: record.skill.skillKey,
      name: record.skill.name,
      description: record.skill.description,
      content: record.version.content,
      changeRationale: record.version.changeRationale,
      evidenceReferences: strings(record.version.evidenceReferences),
      requiredCapabilities: strings(record.version.requiredCapabilities),
      allowedTools: strings(record.version.allowedTools),
    },
    {
      allowedTools: strings(record.definition.allowedTools),
      allowedCapabilities: strings(record.definition.capabilityRequirements),
      ...(baselineScore !== undefined ? { baselineScore } : {}),
    },
  );
  return database().transaction(async (tx) => {
    const [saved] = await tx
      .insert(schema.agentSkillEvaluations)
      .values({
        id: newId(),
        organisationId: context.organisationId,
        skillVersionId: versionId,
        evaluatorActorId: context.actorId,
        suite: evaluation.suite,
        passed: evaluation.passed,
        score: evaluation.score,
        baselineScore: evaluation.baselineScore,
        regressions: evaluation.regressions,
        result: { diagnostics: evaluation.diagnostics },
      })
      .returning();
    await tx
      .update(schema.agentSkillVersions)
      .set({ state: evaluation.passed ? "evaluating" : "rejected" })
      .where(eq(schema.agentSkillVersions.id, versionId));
    await tx
      .update(schema.agentSkills)
      .set({
        status: evaluation.passed ? "evaluating" : "draft",
        updatedAt: new Date(),
      })
      .where(eq(schema.agentSkills.id, record.skill.id));
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: "agent.skill.evaluated",
      targetType: "agent_skill_version",
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

async function approvalForVersion(context: LearningContext, versionId: string) {
  const approvals = await database()
    .select()
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.organisationId, context.organisationId),
        eq(schema.approvals.actionType, "agent.skill.publish"),
      ),
    );
  return approvals.find((approval) => {
    const target =
      approval.target && typeof approval.target === "object"
        ? (approval.target as Record<string, unknown>)
        : {};
    return target.skillVersionId === versionId;
  });
}

async function publishSkill(
  context: LearningContext,
  versionId: string,
  reason = "Evaluation passed and publication approved",
) {
  const record = await versionContext(context, versionId);
  const [evaluation] = await database()
    .select()
    .from(schema.agentSkillEvaluations)
    .where(
      and(
        eq(schema.agentSkillEvaluations.organisationId, context.organisationId),
        eq(schema.agentSkillEvaluations.skillVersionId, versionId),
      ),
    )
    .orderBy(desc(schema.agentSkillEvaluations.createdAt))
    .limit(1);
  const approval = await approvalForVersion(context, versionId);
  if (!evaluation || !approval || approval.status !== "pending") {
    throw new Error("Pending approval and completed evaluation are required");
  }
  const publication = mayPublishSkill(
    {
      passed: evaluation.passed,
      score: evaluation.score,
      ...(evaluation.baselineScore !== null
        ? { baselineScore: evaluation.baselineScore }
        : {}),
      regressions: strings(evaluation.regressions),
    },
    true,
  );
  if (!publication.allowed) throw new Error(publication.reasons.join("; "));
  const now = new Date();
  return database().transaction(async (tx) => {
    if (record.skill.activeVersionId) {
      await tx
        .update(schema.agentSkillVersions)
        .set({ state: "rolled_back" })
        .where(eq(schema.agentSkillVersions.id, record.skill.activeVersionId));
    }
    const [published] = await tx
      .update(schema.agentSkillVersions)
      .set({
        state: "published",
        approvedByActorId: context.actorId,
        approvedAt: now,
      })
      .where(eq(schema.agentSkillVersions.id, versionId))
      .returning();
    await tx
      .update(schema.agentSkills)
      .set({
        status: "published",
        activeVersionId: versionId,
        updatedAt: now,
      })
      .where(eq(schema.agentSkills.id, record.skill.id));
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
      action: "agent.skill.published",
      targetType: "agent_skill_version",
      targetId: versionId,
      metadata: { approvalId: approval.id, reason },
      traceId: context.traceId,
    });
    await writeOutbox(tx, {
      organisationId: context.organisationId,
      eventType: "agent.skill.published",
      aggregateType: "agent_skill_version",
      aggregateId: versionId,
      queueName: "muster-agents",
      payload: { agentId: context.agentId, skillId: record.skill.id },
      idempotencyKey: `agent.skill.published:${versionId}`,
      traceId: context.traceId,
    });
    return published;
  });
}

async function rejectSkill(
  context: LearningContext,
  versionId: string,
  reason = "Rejected by human reviewer",
) {
  const record = await versionContext(context, versionId);
  const approval = await approvalForVersion(context, versionId);
  return database().transaction(async (tx) => {
    await tx
      .update(schema.agentSkillVersions)
      .set({ state: "rejected" })
      .where(eq(schema.agentSkillVersions.id, versionId));
    await tx
      .update(schema.agentSkills)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(schema.agentSkills.id, record.skill.id));
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
      action: "agent.skill.rejected",
      targetType: "agent_skill_version",
      targetId: versionId,
      metadata: { reason },
      traceId: context.traceId,
    });
    return { versionId, state: "rejected" as const };
  });
}

async function rollbackSkill(
  context: LearningContext,
  versionId: string,
  reason = "Rolled back by human reviewer",
) {
  const record = await versionContext(context, versionId);
  if (
    record.skill.activeVersionId !== versionId ||
    !record.version.basedOnVersionId
  ) {
    throw new Error("Only an active version with a predecessor can roll back");
  }
  const previousId = record.version.basedOnVersionId;
  return database().transaction(async (tx) => {
    await tx
      .update(schema.agentSkillVersions)
      .set({ state: "rolled_back" })
      .where(eq(schema.agentSkillVersions.id, versionId));
    await tx
      .update(schema.agentSkillVersions)
      .set({ state: "published" })
      .where(
        and(
          eq(schema.agentSkillVersions.id, previousId),
          eq(schema.agentSkillVersions.organisationId, context.organisationId),
        ),
      );
    await tx
      .update(schema.agentSkills)
      .set({
        status: "published",
        activeVersionId: previousId,
        updatedAt: new Date(),
      })
      .where(eq(schema.agentSkills.id, record.skill.id));
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: "agent.skill.rolled_back",
      targetType: "agent_skill_version",
      targetId: versionId,
      metadata: { restoredVersionId: previousId, reason },
      traceId: context.traceId,
    });
    return { versionId, restoredVersionId: previousId };
  });
}

async function retireSkill(
  context: LearningContext,
  versionId: string,
  reason = "Retired by human reviewer",
) {
  const record = await versionContext(context, versionId);
  return database().transaction(async (tx) => {
    await tx
      .update(schema.agentSkillVersions)
      .set({ state: "rolled_back" })
      .where(eq(schema.agentSkillVersions.id, versionId));
    await tx
      .update(schema.agentSkills)
      .set({ status: "retired", activeVersionId: null, updatedAt: new Date() })
      .where(eq(schema.agentSkills.id, record.skill.id));
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: "agent.skill.retired",
      targetType: "agent_skill",
      targetId: record.skill.id,
      metadata: { versionId, reason },
      traceId: context.traceId,
    });
    return { skillId: record.skill.id, status: "retired" as const };
  });
}

async function setKillSwitch(
  context: LearningContext,
  enabled: boolean,
  reason: string,
) {
  return database().transaction(async (tx) => {
    const now = new Date();
    const [definition] = await tx
      .update(schema.agentDefinitions)
      .set({ killSwitch: enabled, updatedAt: now })
      .where(
        and(
          eq(schema.agentDefinitions.id, context.agentId),
          eq(schema.agentDefinitions.organisationId, context.organisationId),
        ),
      )
      .returning();
    if (!definition) throw new Error("Agent not found in organisation");
    const cancelledRuns = enabled
      ? await tx
          .update(schema.agentRuns)
          .set({
            status: "cancelled",
            cancellationRequestedAt: now,
            cancellationReason: `Agent kill switch: ${reason}`,
            completedAt: now,
            leaseExpiresAt: null,
            heartbeatAt: now,
            progress: { stage: "cancelled", percent: 100 },
          })
          .where(
            and(
              eq(schema.agentRuns.organisationId, context.organisationId),
              eq(schema.agentRuns.agentId, context.agentId),
              or(
                eq(schema.agentRuns.status, "queued"),
                eq(schema.agentRuns.status, "running"),
              ),
            ),
          )
          .returning({
            id: schema.agentRuns.id,
            organisationId: schema.agentRuns.organisationId,
            agentId: schema.agentRuns.agentId,
            roomId: schema.agentRuns.roomId,
            investigationId: schema.agentRuns.investigationId,
            request: schema.agentRuns.request,
          })
      : [];
    if (cancelledRuns.length > 0) {
      const safeReason = redactObservationText(reason);
      await tx.insert(schema.agentRunEvents).values(
        cancelledRuns.map((run) => ({
          id: newId(),
          organisationId: context.organisationId,
          runId: run.id,
          eventType: "cancelled",
          message: "Agent kill switch cancelled execution",
          payload: { reason: safeReason },
        })),
      );
      for (const run of cancelledRuns) {
        const request = z
          .object({
            kind: z.literal("direct_message"),
            sourceMessageId: z.string().uuid(),
            traceId: z.string().optional(),
          })
          .safeParse(run.request);
        if (!request.success || !run.roomId) continue;
        const [source] = await tx
          .select({ id: schema.messages.id })
          .from(schema.messages)
          .innerJoin(
            schema.rooms,
            and(
              eq(schema.rooms.organisationId, run.organisationId),
              eq(schema.rooms.id, run.roomId),
              eq(schema.rooms.roomType, "direct"),
              isNull(schema.rooms.archivedAt),
            ),
          )
          .innerJoin(
            schema.roomMemberships,
            and(
              eq(schema.roomMemberships.organisationId, run.organisationId),
              eq(schema.roomMemberships.roomId, run.roomId),
              eq(schema.roomMemberships.actorId, run.agentId),
              or(
                isNull(schema.roomMemberships.accessExpiresAt),
                gt(schema.roomMemberships.accessExpiresAt, now),
              ),
            ),
          )
          .where(
            and(
              eq(schema.messages.organisationId, run.organisationId),
              eq(schema.messages.id, request.data.sourceMessageId),
              eq(schema.messages.roomId, run.roomId),
              isNull(schema.messages.deletedAt),
            ),
          )
          .limit(1);
        if (!source) continue;
        const [message] = await tx
          .insert(schema.messages)
          .values({
            id: newId(),
            organisationId: run.organisationId,
            roomId: run.roomId,
            threadParentId: request.data.sourceMessageId,
            authorActorId: run.agentId,
            messageType: "agent-status",
            document: {
              type: "agent-direct-message-reply",
              status: "cancelled",
              sourceMessageId: request.data.sourceMessageId,
              agentRunId: run.id,
              failureCode: "agent_kill_switch",
            },
            plainText: "The agent request was cancelled (agent_kill_switch).",
            dataClassification: "internal",
            relatedInvestigationId: run.investigationId,
            relatedAgentRunId: run.id,
            idempotencyKey: `agent-direct-message-reply:${run.id}`,
          })
          .onConflictDoNothing()
          .returning({ id: schema.messages.id });
        if (!message) continue;
        await writeOutbox(tx, {
          organisationId: run.organisationId,
          eventType: "room.message.created",
          aggregateType: "message",
          aggregateId: message.id,
          queueName: "muster-outbox",
          payload: {
            messageId: message.id,
            roomId: run.roomId,
            threadParentId: request.data.sourceMessageId,
            agentRunId: run.id,
          },
          idempotencyKey: `room.message.created:agent-direct-message:${run.id}`,
          traceId: redactObservationText(
            request.data.traceId ?? `agent-run-${run.id}`,
          ),
        });
      }
    }
    await appendAuditEvent(tx, {
      organisationId: context.organisationId,
      actorId: context.actorId,
      actorType: "human",
      action: enabled
        ? "agent.kill_switch.enabled"
        : "agent.kill_switch.disabled",
      targetType: "agent",
      targetId: context.agentId,
      metadata: {
        reason: redactObservationText(reason),
        cancelledRunIds: cancelledRuns.map((run) => run.id),
      },
      traceId: context.traceId,
    });
    await writeOutbox(tx, {
      organisationId: context.organisationId,
      eventType: enabled
        ? "agent.kill_switch.enabled"
        : "agent.kill_switch.disabled",
      aggregateType: "agent",
      aggregateId: context.agentId,
      queueName: "muster-agents",
      payload: { enabled, reason },
      idempotencyKey: `agent.kill-switch:${context.agentId}:${enabled}:${Date.now()}`,
      traceId: context.traceId,
    });
    return {
      agentId: context.agentId,
      killSwitch: definition.killSwitch,
    };
  });
}
