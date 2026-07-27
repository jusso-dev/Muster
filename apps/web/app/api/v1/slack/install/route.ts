import { requireCapability } from "@muster/authz";
import { signSlackOAuthState } from "@muster/agent-harness";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

const scopes = ["app_mentions:read", "chat:write", "commands", "im:history"];

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "administration.manage");
    const clientId = process.env.SLACK_CLIENT_ID;
    const redirectUri = process.env.SLACK_REDIRECT_URI;
    if (!clientId || !redirectUri) throw new Error("Slack OAuth is not configured");
    const state = signSlackOAuthState({
      organisationId: subject.organisationId,
      actorId: subject.actorId,
      expiresAt: Date.now() + 10 * 60_000,
    });
    const authorizationUrl = new URL("https://slack.com/oauth/v2/authorize");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", scopes.join(","));
    authorizationUrl.searchParams.set("state", state);
    return Response.json({ data: { authorizationUrl: authorizationUrl.toString() }, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
