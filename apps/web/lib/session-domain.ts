import { and, eq } from "drizzle-orm";
import { auth } from "@muster/auth";
import {
  capabilities,
  type AuthorisationSubject,
  type Capability,
} from "@muster/authz";
import { database, schema } from "@muster/database";
import { ApiProblem } from "./api-context.ts";
import type { SessionContext } from "@/types/os";

export async function getSessionContext(
  request: Request,
): Promise<SessionContext> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    throw new ApiProblem(401, "Unauthorised", "Authentication is required.");

  const db = database();
  const [actor] = await db
    .select({
      id: schema.actors.id,
      displayName: schema.actors.displayName,
      organisationId: schema.actors.organisationId,
      actorType: schema.actors.actorType,
      capabilityAssignments: schema.actors.capabilityAssignments,
      identityReference: schema.actors.identityReference,
    })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.identityReference, session.user.email),
        eq(schema.actors.actorType, "human"),
      ),
    )
    .limit(1);

  if (!actor)
    throw new ApiProblem(
      403,
      "Forbidden",
      "No organisation actor is linked to this account.",
    );

  const [organisation] = await db
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      slug: schema.organisations.slug,
      status: schema.organisations.status,
      dataRegion: schema.organisations.dataRegion,
      timezone: schema.organisations.defaultTimezone,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, actor.organisationId))
    .limit(1);

  if (!organisation)
    throw new ApiProblem(
      403,
      "Forbidden",
      "Organisation for this actor is not available.",
    );

  const assigned = Array.isArray(actor.capabilityAssignments)
    ? actor.capabilityAssignments.filter(
        (value): value is Capability =>
          typeof value === "string" &&
          capabilities.includes(value as Capability),
      )
    : [];

  return {
    actor: {
      id: actor.id,
      displayName: actor.displayName,
      email: session.user.email ?? actor.identityReference ?? null,
      actorType: actor.actorType === "agent" ? "agent" : "human",
    },
    organisation: {
      id: organisation.id,
      name: organisation.name,
      slug: organisation.slug,
      status: organisation.status,
      dataRegion: organisation.dataRegion,
      timezone: organisation.timezone,
    },
    capabilities: assigned,
    environment:
      process.env.MUSTER_ENVIRONMENT?.trim() ||
      process.env.NODE_ENV ||
      "development",
    organisations: [
      {
        id: organisation.id,
        name: organisation.name,
        slug: organisation.slug,
      },
    ],
    customer: null,
  };
}

/** Reuse for routes that already have a subject and need org display. */
export async function organisationLabel(
  subject: AuthorisationSubject,
): Promise<{ id: string; name: string; slug: string } | null> {
  const [row] = await database()
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      slug: schema.organisations.slug,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, subject.organisationId))
    .limit(1);
  return row ?? null;
}
