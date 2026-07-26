# ADR 0001: System and authority boundaries

Status: Accepted  
Date: 2026-07-26

## Decision

Muster uses three deployable TypeScript processes:

- Next.js web handles rendering, authentication, browser APIs, capability checks, short transactions, and SSE.
- BullMQ worker handles ingestion, integrations, agents, workflows, notifications, evidence, search, maintenance, and outbox dispatch.
- Agent gateway handles runtime isolation, prompt boundaries, allowed tools, approval checks, schema validation, streaming, cancellation, and usage accounting.

PostgreSQL is authoritative. Redis contains transient fan-out, queue state, presence, and typing signals only.

Kelpie owns formal cases. Tawny owns endpoint telemetry and response execution. Bower owns application telemetry selection and delivery proof. Muster stores references and collaboration history, not copies of their authoritative stores.

## Consequences

- HTTP handlers never wait for external enrichment, case creation, endpoint hunts, or agent runtimes.
- Significant commands atomically write domain state and an outbox event.
- At-least-once delivery is expected; all consumers require idempotency.
- Integration health can degrade without corrupting committed Muster state.
