import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  requireCapability,
  starterRoleCapabilities,
  type AuthorisationSubject,
  type Capability,
  type StarterRole,
} from "@muster/authz";
import { auth } from "@muster/auth";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
} from "@muster/database";
import { z } from "zod";
import { ApiProblem } from "./api-context.ts";

const ROLE_KEYS = [
  "administrator",
  "security_manager",
  "incident_commander",
  "senior_analyst",
  "analyst",
  "detection_engineer",
  "threat_hunter",
  "read_only",
  "auditor",
] as const satisfies readonly StarterRole[];

const InviteHumanSchema = z.object({
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().min(1).max(120),
  jobTitle: z.string().trim().max(120).optional(),
  team: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(80).default("Australia/Sydney"),
  role: z.enum(ROLE_KEYS).default("analyst"),
  temporaryPassword: z.string().min(12).max(128),
});

const UpdateActorSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  team: z.string().trim().max(120).nullable().optional(),
  role: z.enum(ROLE_KEYS).optional(),
});

function roleCapabilities(role: StarterRole): Capability[] {
  return [...starterRoleCapabilities[role]];
}

/**
 * Invite a human: Better Auth sign-up + domain user + human actor.
 * Returns a one-time password only if the caller supplied one (echo for UI).
 */
export async function inviteHumanMember(
  subject: AuthorisationSubject,
  raw: unknown,
  traceId: string,
) {
  requireCapability(subject, "administration.manage");
  const input = InviteHumanSchema.parse(raw);
  const email = input.email.toLowerCase();
  const db = database();

  const [existingActor] = await db
    .select({ id: schema.actors.id })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, subject.organisationId),
        eq(schema.actors.identityReference, email),
      ),
    )
    .limit(1);
  if (existingActor)
    throw new ApiProblem(
      409,
      "Member exists",
      "An actor with this email already exists in the organisation.",
    );

  let authUserId: string;
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password: input.temporaryPassword,
        name: input.displayName,
      },
    });
    authUserId = result.user.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-up failed";
    // If auth user already exists (re-invite), look it up.
    const [existingAuth] = await db
      .select({ id: schema.authUsers.id })
      .from(schema.authUsers)
      .where(eq(schema.authUsers.email, email))
      .limit(1);
    if (!existingAuth)
      throw new ApiProblem(400, "Invite failed", message);
    authUserId = existingAuth.id;
  }

  const actorId = newId();
  const userId = newId();
  const caps = roleCapabilities(input.role);

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.actors)
      .values({
        id: actorId,
        organisationId: subject.organisationId,
        actorType: "human",
        displayName: input.displayName,
        status: "active",
        identityReference: email,
        capabilityAssignments: caps,
      })
      .onConflictDoNothing();

    await tx
      .insert(schema.users)
      .values({
        id: userId,
        organisationId: subject.organisationId,
        betterAuthUserId: authUserId,
        displayName: input.displayName,
        email,
        jobTitle: input.jobTitle ?? null,
        team: input.team ?? null,
        timezone: input.timezone,
      })
      .onConflictDoNothing();

    await appendAuditEvent(tx, {
      organisationId: subject.organisationId,
      actorId: subject.actorId,
      actorType: "human",
      action: "directory.human.invited",
      targetType: "actor",
      targetId: actorId,
      metadata: {
        email,
        role: input.role,
        via: "web",
      },
      traceId,
    });
  });

  return {
    actorId,
    email,
    displayName: input.displayName,
    role: input.role,
    // Echo only so the inviter can copy it once; not stored.
    temporaryPassword: input.temporaryPassword,
  };
}

export async function updateDirectoryActor(
  subject: AuthorisationSubject,
  actorId: string,
  raw: unknown,
  traceId: string,
) {
  requireCapability(subject, "administration.manage");
  const input = UpdateActorSchema.parse(raw);
  const db = database();

  const [actor] = await db
    .select()
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, subject.organisationId),
        eq(schema.actors.id, actorId),
      ),
    )
    .limit(1);
  if (!actor)
    throw new ApiProblem(404, "Not found", "Directory actor does not exist.");
  if (actor.id === subject.actorId && input.status === "inactive")
    throw new ApiProblem(
      400,
      "Cannot deactivate self",
      "You cannot deactivate your own account.",
    );

  await db.transaction(async (tx) => {
    await tx
      .update(schema.actors)
      .set({
        displayName: input.displayName ?? actor.displayName,
        status: input.status ?? actor.status,
        capabilityAssignments: input.role
          ? roleCapabilities(input.role)
          : actor.capabilityAssignments,
      })
      .where(
        and(
          eq(schema.actors.organisationId, subject.organisationId),
          eq(schema.actors.id, actorId),
        ),
      );

    if (
      actor.actorType === "human" &&
      typeof actor.identityReference === "string" &&
      (input.jobTitle !== undefined ||
        input.team !== undefined ||
        input.displayName)
    ) {
      await tx
        .update(schema.users)
        .set({
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
          ...(input.team !== undefined ? { team: input.team } : {}),
        })
        .where(
          and(
            eq(schema.users.organisationId, subject.organisationId),
            eq(schema.users.email, actor.identityReference),
          ),
        );
    }

    await appendAuditEvent(tx, {
      organisationId: subject.organisationId,
      actorId: subject.actorId,
      actorType: "human",
      action: "directory.actor.updated",
      targetType: "actor",
      targetId: actorId,
      metadata: { ...input, via: "web" },
      traceId,
    });
  });

  return { id: actorId, status: input.status ?? actor.status };
}

/**
 * Remove demo/synthetic humans and orphan agent actors (no agent_definitions).
 * Soft-deactivates only — preserves audit FKs.
 */
export async function purgeDemoDirectoryMembers(
  subject: AuthorisationSubject,
  traceId: string,
) {
  requireCapability(subject, "administration.manage");
  const db = database();

  const demoHumanIds = await db
    .select({ id: schema.actors.id, displayName: schema.actors.displayName })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, subject.organisationId),
        eq(schema.actors.actorType, "human"),
        sql`${schema.actors.identityReference} like '%@yuma.example'`,
        sql`${schema.actors.id} <> ${subject.actorId}`,
      ),
    );

  const orphanAgents = await db
    .select({
      id: schema.actors.id,
      displayName: schema.actors.displayName,
    })
    .from(schema.actors)
    .leftJoin(
      schema.agentDefinitions,
      and(
        eq(schema.agentDefinitions.id, schema.actors.id),
        eq(schema.agentDefinitions.organisationId, subject.organisationId),
      ),
    )
    .where(
      and(
        eq(schema.actors.organisationId, subject.organisationId),
        eq(schema.actors.actorType, "agent"),
        isNull(schema.agentDefinitions.id),
      ),
    );

  const ids = [...demoHumanIds, ...orphanAgents].map((row) => row.id);
  if (ids.length === 0) return { deactivated: [] as string[] };

  await db.transaction(async (tx) => {
    await tx
      .update(schema.actors)
      .set({ status: "inactive" })
      .where(
        and(
          eq(schema.actors.organisationId, subject.organisationId),
          inArray(schema.actors.id, ids),
        ),
      );
    await appendAuditEvent(tx, {
      organisationId: subject.organisationId,
      actorId: subject.actorId,
      actorType: "human",
      action: "directory.demo.purged",
      targetType: "organisation",
      targetId: subject.organisationId,
      metadata: {
        deactivatedIds: ids,
        names: [...demoHumanIds, ...orphanAgents].map((r) => r.displayName),
        via: "web",
      },
      traceId,
    });
  });

  return {
    deactivated: [...demoHumanIds, ...orphanAgents].map((r) => ({
      id: r.id,
      displayName: r.displayName,
    })),
  };
}
