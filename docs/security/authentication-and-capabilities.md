# Authentication and capabilities

Better Auth backs sessions, local email/password development, email verification, TOTP with recovery codes, passkeys, and Microsoft/Entra OIDC. SAML is an adapter boundary, not enabled in this release.

Production policy can require MFA, require passkey or TOTP for privileged roles, force SSO, disable passwords, restrict email domains, and set session/idle limits. Authentication proves identity; an organisation-scoped actor and capabilities authorise every action.

Starter roles map to explicit capabilities in `@muster/authz`. Routes and domain services must call capability checks. Workers and agent tools receive a resolved capability set and cannot trust claims from job bodies. Sensitive operations also evaluate the action approval policy.

Role checks alone are prohibited. A user with a broad title but without `tawny.response.isolate_host` cannot request isolation; a valid approval does not supply a missing execution capability.
