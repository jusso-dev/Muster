# Security policy

## Reporting

Do not open a public issue for a suspected vulnerability. Email `security@jusso.dev` with:

- affected version or commit  
- impact and prerequisites  
- reproduction steps or proof of concept  
- suggested mitigation, if known  

Do not include real credentials, case data, telemetry, or production tokens. We aim to acknowledge reports within three business days and coordinate remediation and disclosure.

## Supported versions

Until the first stable release, only the latest `main` commit receives security fixes.

## Deployment baseline

Operators should:

- set a strong `MUSTER_OPS_TOKEN` outside local development  
- keep the ops API on a private network or behind authenticated TLS  
- use least-privilege upstream API tokens (read-only where possible)  
- store secrets in a secret manager, not in git  
- review [docs/security/threat-model.md](docs/security/threat-model.md) against their topology  

## Non-goals

Muster is not a SIEM, EDR, SOAR, or authoritative incident case store. Formal cases, endpoint telemetry, and TI collection belong in dedicated products that Muster queries.
