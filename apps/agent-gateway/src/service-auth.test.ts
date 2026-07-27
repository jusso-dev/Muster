import { describe, expect, it } from "vitest";
import {
  isGatewayRequestAuthorised,
  parseGatewayOrganisationId,
} from "./service-auth.ts";

const token = "synthetic-agent-gateway-token-at-least-32-bytes";

describe("agent gateway service authentication", () => {
  it("accepts only the exact bearer token", () => {
    expect(isGatewayRequestAuthorised(`Bearer ${token}`, token)).toBe(true);
    expect(isGatewayRequestAuthorised(undefined, token)).toBe(false);
    expect(isGatewayRequestAuthorised(`Basic ${token}`, token)).toBe(false);
    expect(isGatewayRequestAuthorised(`Bearer ${token}x`, token)).toBe(false);
    expect(
      isGatewayRequestAuthorised(
        "Bearer synthetic-agent-gateway-token-wrong-value",
        token,
      ),
    ).toBe(false);
  });

  it("accepts one valid organisation UUID header", () => {
    const organisationId = "019fa127-8566-770b-939a-971ce03829f6";
    expect(parseGatewayOrganisationId(organisationId)).toBe(organisationId);
    expect(parseGatewayOrganisationId(undefined)).toBeNull();
    expect(parseGatewayOrganisationId("not-an-id")).toBeNull();
    expect(parseGatewayOrganisationId([organisationId])).toBeNull();
  });
});
