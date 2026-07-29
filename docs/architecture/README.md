# Muster architecture

Muster is a TypeScript-first modular monolith with process boundaries: browser-facing
ops web UI, MCP server, asynchronous worker, and isolated agent gateway. Packages own
domain logic; PostgreSQL owns durable state.

Chat is not the web product: Slack + Hermes own conversation. See
[ADR 0006](0006-ops-control-plane-ui.md).

## System

```mermaid
flowchart TB
  subgraph Client
    Browser[Web/PWA]
    Desktop[Future Tauri client]
  end
  subgraph Muster
    Web[Next.js web]
    Worker[BullMQ worker]
    Gateway[Agent gateway]
    DB[(PostgreSQL)]
    Redis[(Redis/BullMQ)]
    Objects[(Private object storage)]
  end
  subgraph Products
    Kelpie[Kelpie cases]
    Tawny[Tawny endpoints]
    Bower[Bower telemetry health]
    Sentinel[Microsoft Sentinel]
  end
  Browser -->|HTTP + SSE| Web
  Desktop -. reuses contracts/UI .-> Web
  Web --> DB
  Web --> Objects
  DB -->|outbox| Worker
  Worker --> Redis
  Redis --> Worker
  Redis --> Gateway
  Worker --> Products
  Gateway --> Products
```

## Room message flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as Web
  participant P as PostgreSQL
  participant R as Redis
  B->>W: POST /rooms/:id/messages + idempotency key
  W->>W: session, tenant, capability, membership checks
  W->>P: transaction(message + audit + outbox)
  P-->>W: commit
  W-->>B: 201 message
  P->>R: outbox dispatcher publishes identifier-only job
  R-->>W: ephemeral update
  W-->>B: SSE room.message.created
```

## Alert to investigation

```mermaid
flowchart LR
  S[Signed MSEP alert] --> V[Verify signature + replay window]
  V --> D[Organisation-scoped dedupe]
  D --> A[(Alert)]
  A --> C[Correlation worker]
  C --> I[(Investigation)]
  I --> R[Investigation room]
  I --> H[Hunts and enrichments]
```

## Investigation to Kelpie

```mermaid
sequenceDiagram
  participant A as Analyst
  participant M as Muster
  participant K as Kelpie
  A->>M: Request promotion
  M->>M: Create approval and room/timeline event
  A->>M: Approve with investigations.promote
  M->>K: Idempotent case-create request
  K-->>M: Authoritative case number/version
  M->>M: Link case; audit; preserve pre-case context
  M->>K: Apply selected playbook/timeline references
```

## Agent invocation

```mermaid
sequenceDiagram
  participant H as Human/workflow
  participant W as Web/worker
  participant G as Agent gateway
  participant T as Allowed tool
  H->>W: Invoke agent
  W->>W: Check capability, room, budget, classification
  W->>G: Identifier-only job + trusted policy
  G->>G: Load state; separate untrusted evidence
  G->>T: Validated, allowlisted read call
  T-->>G: Untrusted tool result
  G->>G: Validate typed output
  G-->>W: Progress + finding reference + usage
  W->>W: Room event + investigation timeline + audit
```

## Approval workflow

```mermaid
stateDiagram-v2
  [*] --> Pending
  Pending --> Approved: required actors approve
  Pending --> Rejected: authorised rejection
  Pending --> Expired: deadline
  Pending --> Cancelled: requester/system
  Approved --> Executed: idempotent connector success
  Approved --> Failed: bounded retries exhausted
  Executed --> [*]
  Rejected --> [*]
  Expired --> [*]
  Cancelled --> [*]
  Failed --> [*]
```

## Transactional outbox and BullMQ

```mermaid
flowchart LR
  T[Domain transaction] --> D[(Domain rows)]
  T --> O[(Outbox row)]
  O --> C[Claim with SKIP LOCKED]
  C --> Q[BullMQ queue]
  Q --> J[Idempotent processor]
  J --> P[(Authoritative state reload)]
  J --> X[External connector]
  X -->|timeout/failure| B[Per-queue backoff]
  B --> Q
  J -->|terminal failure| L[Visible failed job + delivery record]
  Q -->|duplicate| J
```

## Authentication

```mermaid
sequenceDiagram
  participant U as User
  participant A as Better Auth
  participant I as Entra/OIDC or local identity
  participant M as Muster authorisation
  U->>A: Sign in + passkey/TOTP policy
  A->>I: Verify identity
  I-->>A: Subject
  A-->>U: HttpOnly scoped session
  U->>M: Request
  M->>M: Resolve organisation actor + capabilities
  M-->>U: Tenant-filtered result or problem response
```

## Multi-tenant boundary

```mermaid
flowchart TB
  R[Authenticated request/job] --> O[Resolved organisation]
  O --> C[Capability check]
  C --> S[Service requires organisationId]
  S --> Q[Repository adds organisation predicate]
  Q --> P[(PostgreSQL constraints/indexes)]
  P --> A[Audit event includes organisation + actor]
  X[Foreign organisation identifier] -->|never looked up globally| N[404/403 + audit]
```

See the ADRs in this directory for ownership, sortable identifiers, tenancy, and governed agent learning.
