import { and, desc, eq } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
} from "@muster/database";
import { z } from "zod";
import { McpToolError } from "./errors.ts";
import { requireScope, type InstallationContext } from "./installation.ts";
import type { ToolResult } from "./tools.ts";

type Database = ReturnType<typeof database>;

export const MissionUpsertSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i),
  description: z.string().trim().max(4_000).default(""),
  capabilityEnvelope: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  scheduleHint: z.string().trim().max(200).optional(),
  hermesProfile: z.string().trim().max(200).optional(),
  status: z.enum(["active", "paused", "cancelled", "archived"]).default("active"),
  killSwitch: z.boolean().default(false),
});

export const MissionRunSchema = z.object({
  missionId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(200),
  hermesProfile: z.string().trim().max(200).optional(),
  deliveryEvidence: z.record(z.string(), z.unknown()).default({}),
});

function publicMission(row: typeof schema.governedMissions.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    capabilityEnvelope: row.capabilityEnvelope,
    scheduleHint: row.scheduleHint,
    hermesProfile: row.hermesProfile,
    killSwitch: row.killSwitch,
    cancellationPolicy: row.cancellationPolicy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listMissions(
  db: Database,
  context: InstallationContext,
  args: { limit: number },
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_list_missions");
  requireCapability(context.subject, "workflows.read");
  const limit = Math.min(Math.max(args.limit, 1), 50);
  const rows = await db
    .select()
    .from(schema.governedMissions)
    .where(
      eq(schema.governedMissions.organisationId, context.subject.organisationId),
    )
    .orderBy(desc(schema.governedMissions.updatedAt))
    .limit(limit);
  return {
    payload: { records: rows.map(publicMission), limit },
    evidenceRefs: rows.map((r) => r.id),
  };
}

export async function upsertMission(
  db: Database,
  context: InstallationContext,
  raw: unknown,
  traceId: string,
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_upsert_mission");
  requireCapability(context.subject, "workflows.manage");

  let input: z.infer<typeof MissionUpsertSchema>;
  try {
    input = MissionUpsertSchema.parse(raw);
  } catch (error) {
    throw new McpToolError(
      "invalid_input",
      error instanceof Error ? error.message : "Invalid mission definition.",
    );
  }

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.governedMissions)
      .where(
        and(
          eq(
            schema.governedMissions.organisationId,
            context.subject.organisationId,
          ),
          eq(schema.governedMissions.name, input.name),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await tx
        .update(schema.governedMissions)
        .set({
          description: input.description,
          capabilityEnvelope: input.capabilityEnvelope,
          scheduleHint: input.scheduleHint ?? null,
          hermesProfile: input.hermesProfile ?? null,
          status: input.status,
          killSwitch: input.killSwitch,
          updatedByActorId: context.subject.actorId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(
              schema.governedMissions.organisationId,
              context.subject.organisationId,
            ),
            eq(schema.governedMissions.id, existing.id),
          ),
        )
        .returning();
      await appendAuditEvent(tx, {
        organisationId: context.subject.organisationId,
        actorId: context.subject.actorId,
        actorType: context.actorType,
        action: "mission.updated",
        targetType: "governed_mission",
        targetId: existing.id,
        metadata: {
          name: input.name,
          status: input.status,
          killSwitch: input.killSwitch,
          installationId: context.installationId,
        },
        traceId,
      });
      return { mission: publicMission(updated!), created: false };
    }

    const id = newId();
    const [created] = await tx
      .insert(schema.governedMissions)
      .values({
        id,
        organisationId: context.subject.organisationId,
        name: input.name,
        description: input.description,
        capabilityEnvelope: input.capabilityEnvelope,
        scheduleHint: input.scheduleHint,
        hermesProfile: input.hermesProfile,
        status: input.status,
        killSwitch: input.killSwitch,
        createdByActorId: context.subject.actorId,
      })
      .returning();
    await appendAuditEvent(tx, {
      organisationId: context.subject.organisationId,
      actorId: context.subject.actorId,
      actorType: context.actorType,
      action: "mission.created",
      targetType: "governed_mission",
      targetId: id,
      metadata: {
        name: input.name,
        status: input.status,
        installationId: context.installationId,
      },
      traceId,
    });
    return { mission: publicMission(created!), created: true };
  });

  return {
    payload: result,
    evidenceRefs: [result.mission.id as string],
  };
}

/**
 * Accept a Hermes cron/delegation delivery against a mission definition.
 * Idempotent by client key. Kill switch blocks new runs immediately.
 */
export async function acceptMissionRun(
  db: Database,
  context: InstallationContext,
  raw: unknown,
  traceId: string,
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_accept_mission_run");
  requireCapability(context.subject, "workflows.execute");

  let input: z.infer<typeof MissionRunSchema>;
  try {
    input = MissionRunSchema.parse(raw);
  } catch (error) {
    throw new McpToolError(
      "invalid_input",
      error instanceof Error ? error.message : "Invalid mission run.",
    );
  }

  const result = await db.transaction(async (tx) => {
    const [duplicate] = await tx
      .select()
      .from(schema.governedMissionRuns)
      .where(
        and(
          eq(
            schema.governedMissionRuns.organisationId,
            context.subject.organisationId,
          ),
          eq(schema.governedMissionRuns.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (duplicate) {
      return {
        runId: duplicate.id,
        missionId: duplicate.missionId,
        status: duplicate.status,
        duplicate: true,
        blockedReason: duplicate.error,
      };
    }

    const [mission] = await tx
      .select()
      .from(schema.governedMissions)
      .where(
        and(
          eq(
            schema.governedMissions.organisationId,
            context.subject.organisationId,
          ),
          eq(schema.governedMissions.id, input.missionId),
        ),
      )
      .limit(1);
    if (!mission)
      throw new McpToolError(
        "not_found",
        "Mission does not exist for this organisation.",
      );

    let status: "accepted" | "blocked" = "accepted";
    let error: string | null = null;
    if (mission.killSwitch || mission.status === "cancelled") {
      status = "blocked";
      error = mission.killSwitch
        ? "Mission kill switch is active; new actions blocked."
        : "Mission is cancelled; new actions blocked.";
    } else if (mission.status !== "active") {
      status = "blocked";
      error = `Mission status is ${mission.status}; new actions blocked.`;
    }

    const id = newId();
    await tx.insert(schema.governedMissionRuns).values({
      id,
      organisationId: context.subject.organisationId,
      missionId: mission.id,
      idempotencyKey: input.idempotencyKey,
      status,
      hermesInstallationId: context.installationId,
      hermesProfile: input.hermesProfile ?? mission.hermesProfile,
      initiatingActorId: context.subject.actorId,
      deliveryEvidence: {
        ...input.deliveryEvidence,
        via: "mcp",
        installationId: context.installationId,
      },
      error,
    });
    await appendAuditEvent(tx, {
      organisationId: context.subject.organisationId,
      actorId: context.subject.actorId,
      actorType: context.actorType,
      action:
        status === "blocked" ? "mission.run.blocked" : "mission.run.accepted",
      targetType: "governed_mission_run",
      targetId: id,
      metadata: {
        missionId: mission.id,
        missionName: mission.name,
        status,
        installationId: context.installationId,
        hermesProfile: input.hermesProfile ?? mission.hermesProfile,
        idempotencyKey: input.idempotencyKey,
      },
      traceId,
    });
    return {
      runId: id,
      missionId: mission.id,
      status,
      duplicate: false,
      blockedReason: error,
    };
  });

  return {
    payload: result,
    evidenceRefs: [result.runId],
  };
}

export async function getMissionRun(
  db: Database,
  context: InstallationContext,
  args: { runId: string },
): Promise<ToolResult<unknown>> {
  requireScope(context, "muster_get_mission_run");
  requireCapability(context.subject, "workflows.read");
  const [run] = await db
    .select()
    .from(schema.governedMissionRuns)
    .where(
      and(
        eq(
          schema.governedMissionRuns.organisationId,
          context.subject.organisationId,
        ),
        eq(schema.governedMissionRuns.id, args.runId),
      ),
    )
    .limit(1);
  if (!run)
    throw new McpToolError(
      "not_found",
      "Mission run does not exist for this organisation.",
    );
  return {
    payload: {
      runId: run.id,
      missionId: run.missionId,
      status: run.status,
      hermesProfile: run.hermesProfile,
      hermesInstallationId: run.hermesInstallationId,
      deliveryEvidence: run.deliveryEvidence,
      error: run.error,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    evidenceRefs: [run.id],
  };
}
