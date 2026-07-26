import { and, eq } from "drizzle-orm";
import { auth } from "@muster/auth";
import {
  capabilities,
  type AuthorisationSubject,
  type Capability,
} from "@muster/authz";
import { database, schema } from "@muster/database";

export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}

export async function apiSubject(request: Request): Promise<AuthorisationSubject> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ApiProblem(401, "Unauthorised", "Authentication is required.");
  const [actor] = await database()
    .select({
      id: schema.actors.id,
      organisationId: schema.actors.organisationId,
      capabilityAssignments: schema.actors.capabilityAssignments,
    })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.identityReference, session.user.email),
        eq(schema.actors.actorType, "human"),
      ),
    )
    .limit(1);
  if (!actor) throw new ApiProblem(403, "Forbidden", "No organisation actor is linked to this account.");
  const assigned = Array.isArray(actor.capabilityAssignments)
    ? actor.capabilityAssignments.filter(
        (value): value is Capability =>
          typeof value === "string" && capabilities.includes(value as Capability),
      )
    : [];
  return {
    actorId: actor.id,
    organisationId: actor.organisationId,
    capabilities: new Set(assigned),
  };
}

export function problemResponse(error: unknown, traceId: string) {
  const problem =
    error instanceof ApiProblem
      ? error
      : error instanceof Error && error.name === "ForbiddenError"
        ? new ApiProblem(403, "Forbidden", error.message)
        : error instanceof Error
          ? new ApiProblem(400, "Request failed", error.message)
          : new ApiProblem(500, "Internal error", "The request could not be completed.");
  return Response.json(
    {
      type: `https://muster.security/problems/${problem.title.toLowerCase().replaceAll(" ", "-")}`,
      title: problem.title,
      status: problem.status,
      detail: problem.detail,
      traceId,
    },
    { status: problem.status, headers: { "content-type": "application/problem+json" } },
  );
}

export function requestTraceId(request: Request) {
  return request.headers.get("x-trace-id") ?? crypto.randomUUID();
}
