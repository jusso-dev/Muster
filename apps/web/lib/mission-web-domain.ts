import { and, desc, eq, ne } from "drizzle-orm";
import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
} from "@muster/database";
import { z } from "zod";
import { ApiProblem } from "./api-context.ts";
import type { MissionRunSummary, MissionSummary } from "@/types/os";

const MissionWriteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, "Use letters, numbers, dots, dashes, underscores"),
  description: z.string().trim().max(4_000).default(""),
  capabilityEnvelope: z
    .array(z.string().trim().min(1).max(100))
    .max(50)
    .default([]),
  scheduleHint: z.string().trim().max(200).nullable().optional(),
  hermesProfile: z.string().trim().max(200).nullable().optional(),
  status: z.enum(["active", "paused", "cancelled", "archived"]).default("active"),
  killSwitch: z.boolean().default(false),
  changeSummary: z.string().trim().max(500).optional(),
});

export type MissionWriteInput = z.infer<typeof MissionWriteSchema>;

function publicMission(
  row: typeof schema.governedMissions.$inferSelect,
): MissionSummary & { revision: number } {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    status: row.status,
    capabilityEnvelope: Array.isArray(row.capabilityEnvelope)
      ? row.capabilityEnvelope.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    scheduleHint: row.scheduleHint ?? null,
    hermesProfile: row.hermesProfile ?? null,
    killSwitch: Boolean(row.killSwitch),
    revision: row.revision ?? 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function publicRun(
  row: typeof schema.governedMissionRuns.$inferSelect,
): MissionRunSummary {
  return {
    id: row.id,
    missionId: row.missionId,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    hermesProfile: row.hermesProfile ?? null,
    error: row.error ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function snapshotOf(row: typeof schema.governedMissions.$inferSelect) {
  return {
    name: row.name,
    description: row.description,
    status: row.status,
    capabilityEnvelope: row.capabilityEnvelope,
    scheduleHint: row.scheduleHint,
    hermesProfile: row.hermesProfile,
    killSwitch: row.killSwitch,
    cancellationPolicy: row.cancellationPolicy,
    revision: row.revision,
  };
}

async function writeRevision(
  tx: Parameters<Parameters<ReturnType<typeof database>["transaction"]>[0]>[0],
  row: typeof schema.governedMissions.$inferSelect,
  actorId: string,
  changeSummary: string,
) {
  await tx.insert(schema.governedMissionRevisions).values({
    id: newId(),
    organisationId: row.organisationId,
    missionId: row.id,
    revision: row.revision,
    snapshot: snapshotOf(row),
    changeSummary,
    createdByActorId: actorId,
  });
}

export async function listWebMissions(
  subject: AuthorisationSubject,
  limitRaw?: string | null,
  includeArchived = false,
): Promise<(MissionSummary & { revision: number })[]> {
  requireCapability(subject, "workflows.read");
  const limit = z.coerce.number().int().min(1).max(100).parse(limitRaw ?? 50);
  const filters = [
    eq(schema.governedMissions.organisationId, subject.organisationId),
  ];
  if (!includeArchived)
    filters.push(ne(schema.governedMissions.status, "archived"));
  const rows = await database()
    .select()
    .from(schema.governedMissions)
    .where(and(...filters))
    .orderBy(desc(schema.governedMissions.updatedAt))
    .limit(limit);
  return rows.map(publicMission);
}

export async function getWebMission(
  subject: AuthorisationSubject,
  missionId: string,
): Promise<MissionSummary & { revision: number }> {
  requireCapability(subject, "workflows.read");
  const [row] = await database()
    .select()
    .from(schema.governedMissions)
    .where(
      and(
        eq(schema.governedMissions.organisationId, subject.organisationId),
        eq(schema.governedMissions.id, missionId),
      ),
    )
    .limit(1);
  if (!row)
    throw new ApiProblem(404, "Mission not found", "Mission does not exist.");
  return publicMission(row);
}

export async function createWebMission(
  subject: AuthorisationSubject,
  raw: unknown,
  traceId: string,
) {
  requireCapability(subject, "workflows.manage");
  const input = MissionWriteSchema.parse(raw);
  const db = database();
  return db.transaction(async (tx) => {
    const [conflict] = await tx
      .select({ id: schema.governedMissions.id })
      .from(schema.governedMissions)
      .where(
        and(
          eq(schema.governedMissions.organisationId, subject.organisationId),
          eq(schema.governedMissions.name, input.name),
        ),
      )
      .limit(1);
    if (conflict)
      throw new ApiProblem(
        409,
        "Mission exists",
        "A mission with this name already exists.",
      );
    const id = newId();
    const [created] = await tx
      .insert(schema.governedMissions)
      .values({
        id,
        organisationId: subject.organisationId,
        name: input.name,
        description: input.description,
        status: input.status,
        capabilityEnvelope: input.capabilityEnvelope,
        scheduleHint: input.scheduleHint ?? null,
        hermesProfile: input.hermesProfile ?? null,
        killSwitch: input.killSwitch,
        revision: 1,
        createdByActorId: subject.actorId,
        updatedByActorId: subject.actorId,
      })
      .returning();
    await writeRevision(
      tx,
      created!,
      subject.actorId,
      input.changeSummary?.trim() || "Created mission",
    );
    await appendAuditEvent(tx, {
      organisationId: subject.organisationId,
      actorId: subject.actorId,
      actorType: "human",
      action: "mission.created",
      targetType: "governed_mission",
      targetId: id,
      metadata: { name: input.name, revision: 1, via: "web" },
      traceId,
    });
    return publicMission(created!);
  });
}

export async function updateWebMission(
  subject: AuthorisationSubject,
  missionId: string,
  raw: unknown,
  traceId: string,
) {
  requireCapability(subject, "workflows.manage");
  const input = MissionWriteSchema.partial()
    .extend({
      name: MissionWriteSchema.shape.name.optional(),
      changeSummary: z.string().trim().max(500).optional(),
    })
    .parse(raw);
  const db = database();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.governedMissions)
      .where(
        and(
          eq(schema.governedMissions.organisationId, subject.organisationId),
          eq(schema.governedMissions.id, missionId),
        ),
      )
      .limit(1);
    if (!existing)
      throw new ApiProblem(404, "Mission not found", "Mission does not exist.");
    if (input.name && input.name !== existing.name) {
      const [conflict] = await tx
        .select({ id: schema.governedMissions.id })
        .from(schema.governedMissions)
        .where(
          and(
            eq(schema.governedMissions.organisationId, subject.organisationId),
            eq(schema.governedMissions.name, input.name),
          ),
        )
        .limit(1);
      if (conflict)
        throw new ApiProblem(
          409,
          "Mission exists",
          "A mission with this name already exists.",
        );
    }
    const nextRevision = (existing.revision ?? 1) + 1;
    const [updated] = await tx
      .update(schema.governedMissions)
      .set({
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        status: input.status ?? existing.status,
        capabilityEnvelope:
          input.capabilityEnvelope ?? existing.capabilityEnvelope,
        scheduleHint:
          input.scheduleHint !== undefined
            ? input.scheduleHint
            : existing.scheduleHint,
        hermesProfile:
          input.hermesProfile !== undefined
            ? input.hermesProfile
            : existing.hermesProfile,
        killSwitch: input.killSwitch ?? existing.killSwitch,
        revision: nextRevision,
        updatedByActorId: subject.actorId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.governedMissions.organisationId, subject.organisationId),
          eq(schema.governedMissions.id, missionId),
        ),
      )
      .returning();
    await writeRevision(
      tx,
      updated!,
      subject.actorId,
      input.changeSummary?.trim() || "Updated mission",
    );
    await appendAuditEvent(tx, {
      organisationId: subject.organisationId,
      actorId: subject.actorId,
      actorType: "human",
      action: "mission.updated",
      targetType: "governed_mission",
      targetId: missionId,
      metadata: {
        name: updated!.name,
        revision: nextRevision,
        via: "web",
      },
      traceId,
    });
    return publicMission(updated!);
  });
}

export async function deleteWebMission(
  subject: AuthorisationSubject,
  missionId: string,
  traceId: string,
) {
  requireCapability(subject, "workflows.manage");
  return updateWebMission(
    subject,
    missionId,
    {
      status: "archived",
      changeSummary: "Archived (deleted) via UI",
    },
    traceId,
  );
}

export async function listWebMissionRevisions(
  subject: AuthorisationSubject,
  missionId: string,
) {
  requireCapability(subject, "workflows.read");
  await getWebMission(subject, missionId);
  const rows = await database()
    .select()
    .from(schema.governedMissionRevisions)
    .where(
      and(
        eq(
          schema.governedMissionRevisions.organisationId,
          subject.organisationId,
        ),
        eq(schema.governedMissionRevisions.missionId, missionId),
      ),
    )
    .orderBy(desc(schema.governedMissionRevisions.revision))
    .limit(100);
  return rows.map((row) => ({
    id: row.id,
    revision: row.revision,
    changeSummary: row.changeSummary,
    snapshot: row.snapshot,
    createdByActorId: row.createdByActorId,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listWebMissionRuns(
  subject: AuthorisationSubject,
  missionId: string,
  limitRaw?: string | null,
): Promise<MissionRunSummary[]> {
  requireCapability(subject, "workflows.read");
  const limit = z.coerce.number().int().min(1).max(100).parse(limitRaw ?? 50);

  const [mission] = await database()
    .select({ id: schema.governedMissions.id })
    .from(schema.governedMissions)
    .where(
      and(
        eq(schema.governedMissions.organisationId, subject.organisationId),
        eq(schema.governedMissions.id, missionId),
      ),
    )
    .limit(1);
  if (!mission)
    throw new ApiProblem(404, "Mission not found", "Mission does not exist.");

  const rows = await database()
    .select()
    .from(schema.governedMissionRuns)
    .where(
      and(
        eq(schema.governedMissionRuns.organisationId, subject.organisationId),
        eq(schema.governedMissionRuns.missionId, missionId),
      ),
    )
    .orderBy(desc(schema.governedMissionRuns.createdAt))
    .limit(limit);
  return rows.map(publicRun);
}
