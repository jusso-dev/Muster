import { starterRoleCapabilities, type AuthorisationSubject, type StarterRole } from "@muster/authz";

export function testSubject(role: StarterRole, overrides: Partial<Pick<AuthorisationSubject, "actorId" | "organisationId">> = {}): AuthorisationSubject {
  return {
    actorId: overrides.actorId ?? "018f55d8-c4c7-7c3e-88ef-000000000010",
    organisationId: overrides.organisationId ?? "018f55d8-c4c7-7c3e-88ef-000000000001",
    capabilities: new Set(starterRoleCapabilities[role]),
  };
}
