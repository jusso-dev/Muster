import { and, desc, eq } from "drizzle-orm";
import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import { database, schema } from "@muster/database";
import { z } from "zod";
import { ApiProblem } from "./api-context.ts";
import type { MissionRunSummary, MissionSummary } from "@/types/os";

function publicMission(
  row: typeof schema.governedMissions.$inferSelect,
): MissionSummary {
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

export async function listWebMissions(
  subject: AuthorisationSubject,
  limitRaw?: string | null,
): Promise<MissionSummary[]> {
  requireCapability(subject, "workflows.read");
  const limit = z.coerce.number().int().min(1).max(100).parse(limitRaw ?? 50);
  const rows = await database()
    .select()
    .from(schema.governedMissions)
    .where(eq(schema.governedMissions.organisationId, subject.organisationId))
    .orderBy(desc(schema.governedMissions.updatedAt))
    .limit(limit);
  return rows.map(publicMission);
}

export async function getWebMission(
  subject: AuthorisationSubject,
  missionId: string,
): Promise<MissionSummary> {
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
