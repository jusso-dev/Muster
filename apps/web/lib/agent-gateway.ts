export function agentGatewayHeaders(organisationId: string) {
  const token = process.env.MUSTER_AGENT_GATEWAY_TOKEN?.trim();
  if (!token) throw new Error("Agent gateway token is not configured");
  return {
    authorization: `Bearer ${token}`,
    "x-muster-organisation-id": organisationId,
  };
}
