# Security policy

## Reporting

Do not open a public issue for a suspected vulnerability. Email `security@jusso.dev` with:

- affected version or commit
- impact and prerequisites
- reproduction steps or proof of concept
- suggested mitigation, if known

Do not include real credentials, case data, telemetry, or evidence. We aim to acknowledge reports within three business days and coordinate remediation and disclosure.

## Supported versions

Until the first stable release, only the latest `main` commit receives security fixes.

## Deployment baseline

Production operators must replace all example secrets, disable mock integrations, use TLS, private networking, managed secret storage, encrypted PostgreSQL/Redis/object storage, malware scanning, private buckets, short-lived downloads, backups, restore tests, audit export, and an explicit egress policy. Enforce SSO/MFA and least-privilege capabilities.

Run the threat model in [docs/security/threat-model.md](docs/security/threat-model.md) against local topology and connector versions before go-live.

## Non-goals

Muster is not a SIEM, EDR, SOAR, or authoritative incident case store. Formal cases belong in Kelpie, endpoint telemetry in Tawny, and application telemetry selection and delivery evidence in Bower.
