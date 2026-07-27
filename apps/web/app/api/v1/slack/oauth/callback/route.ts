import {
  SlackGovernanceAdapter,
  verifySlackOAuthState,
} from "@muster/agent-harness";
import { capabilities, type AuthorisationSubject } from "@muster/authz";
import { database, schema } from "@muster/database";
import { and, eq } from "drizzle-orm";
import { problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new Error("Slack OAuth callback is incomplete");
    const verified = verifySlackOAuthState(state);
    const [actor] = await database()
      .select({ capabilities: schema.actors.capabilityAssignments })
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.id, verified.actorId),
          eq(schema.actors.organisationId, verified.organisationId),
          eq(schema.actors.actorType, "human"),
          eq(schema.actors.status, "active"),
        ),
      )
      .limit(1);
    if (!actor || !Array.isArray(actor.capabilities))
      throw new Error("Slack OAuth installer is no longer authorised");
    const subject: AuthorisationSubject = {
      actorId: verified.actorId,
      organisationId: verified.organisationId,
      capabilities: new Set(
        actor.capabilities.filter(
          (capability): capability is (typeof capabilities)[number] =>
            typeof capability === "string" &&
            capabilities.includes(capability as (typeof capabilities)[number]),
        ),
      ),
    };
    const installation = await new SlackGovernanceAdapter().install(
      subject,
      code,
      process.env.SLACK_REDIRECT_URI ?? "",
    );
    return Response.json({
      data: {
        id: installation.id,
        teamId: installation.teamId,
        status: installation.status,
      },
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
