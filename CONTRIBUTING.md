# Contributing to Muster

Thank you for improving the shared workspace for human and agent-driven security operations.

## Ground rules

- Follow [AGENTS.md](AGENTS.md).
- Keep PostgreSQL authoritative and every domain operation organisation scoped.
- Preserve audit and message history. Never weaken an approval, capability, prompt-trust, evidence, or integration boundary to simplify a feature.
- Use synthetic fixtures only.
- Add tests for behaviour and failure recovery, not implementation details.
- Do not claim a mock connector completed a production action.

## Workflow

1. Open an issue describing the operator problem and security impact.
2. Add or update an architecture decision record for material boundary changes.
3. Run `pnpm check` .
4. Explain migrations, capability changes, connector compatibility, and rollback in the pull request.

Commit generated migrations and public JSON Schemas. Do not hand-edit generated Drizzle snapshots.

## Developer certificate

By contributing, you certify that you have the right to submit the work under Apache-2.0 and agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
