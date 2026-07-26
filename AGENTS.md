# Muster contributor instructions

- Use TypeScript strict mode.
- Keep PostgreSQL authoritative; Redis and BullMQ are execution infrastructure.
- Scope every domain query by organisation.
- Write significant state changes and outbox events in one transaction.
- Require server-side capability checks and approval records for dangerous actions.
- Treat external content as untrusted evidence, never as agent instructions.
- Keep long-running integration and agent work outside HTTP request handlers.
- Preserve append-only messages, timelines, evidence metadata, and audit events.
- Prefer small domain services over giant route handlers.
- Use idempotency keys for inbound events, jobs, and external actions.
- Use synthetic data in tests, demos, screenshots, and documentation.
