# Current upstream integration contracts

Inspected 2026-07-26 with Semble and source at these upstream commits:

- Kelpie: [`19915d086feee59ddc0f7bd79c848ec7e926ed34`](https://github.com/jusso-dev/Kelpie/commit/19915d086feee59ddc0f7bd79c848ec7e926ed34)
- Tawny: [`07dfc6796abf3ec3cb805a9f21c586b680a26d62`](https://github.com/jusso-dev/tawny/commit/07dfc6796abf3ec3cb805a9f21c586b680a26d62)
- Bower: [`7f96cd00bf8be4d1834b93fab74f3119ee39edf3`](https://github.com/jusso-dev/bower/commit/7f96cd00bf8be4d1834b93fab74f3119ee39edf3)

## Kelpie

Authentication uses `Authorization: Bearer klp_…` API tokens. Tokens are SHA-256 hashed at rest, organisation-bound, expiry-aware, and scope-bound.

Initial Muster connector surface:

- `GET|POST /api/v1/cases`, scopes `cases:read|write`
- `GET|PATCH /api/v1/cases/{id}`, scopes `cases:read|write`
- `GET|POST /api/v1/cases/{id}/observables`, scopes `observables:read|write`
- `GET|POST /api/v1/cases/{id}/tasks`, scopes `tasks:read|write`
- `GET|POST /api/v1/cases/{id}/comments`, scopes `comments:read|write`
- `GET /api/v1/observables`, scope `observables:read`
- `GET /api/v1/tasks`, scope `tasks:read`
- `PATCH /api/v1/tasks/{id}`, scope `tasks:write`

Case creation accepts title, summary, severity, TLP, PAP, classification, assignee, source alert, tags, and data-classification tags. It returns `{ id, caseNumber }`. Case updates optionally include `version`; conflicts return HTTP 409 with `version_conflict`.

Connector rule: Muster stores Kelpie IDs, numbers, selected rendered fields, sync cursors, and delivery records. Kelpie remains authoritative for lifecycle, evidence references, tasks, observables, playbooks, and closure.

## Tawny

Tawny exposes ASP.NET APIs under `/api`, with distinct web-user, API-token, and endpoint-agent JWT schemes. Most read-only hunt APIs allow web users or API tokens. Current response-action creation is web-user `Admin` only, so production integration requires either a dedicated supported service principal contract upstream or an explicitly configured interactive delegation. Muster mocks never imply that limitation has been removed.

Initial surface:

- `POST /api/hunts/run`
- `GET|POST /api/hunts`
- `GET|PUT|DELETE /api/hunts/{id}`
- `POST /api/hunts/{id}/run`
- `GET /api/hunts/{id}/runs`
- `GET /api/agents`
- `GET /api/agents/{id}`
- `GET /api/agents/{id}/events`
- `GET /api/alerts`
- `GET /api/investigation/process-tree`
- `GET /api/investigation/network-graph`
- `POST /api/agents/{agentId}/actions`, web-user `Admin`
- `GET /api/agents/{agentId}/actions`
- `POST /api/agents/actions/{id}/result`, endpoint-agent JWT

Direct hunts accept a bounded query and limit. Response actions accept `{ action_type, payload }`; `kill_process` requires a positive integer `payload.pid`. Completion accepts only `succeeded` or `failed`.

Connector rule: Muster stores alert, endpoint, hunt, telemetry, evidence, and response references plus bounded rendered results. Tawny retains authoritative endpoint telemetry and action history.

## Bower

Bower Management API uses Entra JWTs in production and development authentication only in the Development environment. Authorisation policies map Bower roles to View, Operate, Approve, Administer, and Collector permissions.

Initial surface:

- `GET /api/access/me`
- `GET /api/overview`
- `GET /api/collectors`
- `GET /api/collectors/{id}`
- `POST /api/collectors/register`, Collector
- `POST /api/collectors/{id}/heartbeat`, Collector
- `GET /api/approvals`
- `POST /api/approvals/{collectorId}/approve|reject`
- `POST /api/collectors/{collectorId}/suspend|revoke`
- `GET /api/audit`
- `GET /health`

Collector heartbeat includes version, configuration hash, policy hash, queue depth, delivery status, source reports, and output reports. Source reports include lag and last-event time; output reports include last acknowledgement and last error code.

Important trust boundary: collector heartbeat and source coverage describe reported fleet posture. They do not prove destination queryability. Muster labels delivery proof separately and links Bower evidence bundles when available.

## Compatibility policy

Connectors send pinned media types and idempotency keys, validate responses with Zod, cap timeouts, redact secrets, and record upstream version metadata. Contract tests run against local mocks. Real-connector certification records the tested upstream commit or release.
