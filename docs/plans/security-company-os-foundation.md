# Security Company OS — foundation plan

## Positioning

Muster is the **governed operating system for an AI-enabled security company**.

It coordinates security operations, missions, agents, approvals, evidence, and
integrations without becoming a SIEM, EDR, SOAR, case system, or chat app.
Kelpie / Tawny / Bower / Sentinel / Defender / cloud platforms remain systems of
record. Chat remains Slack / Hermes (ADR 0006).

## Current state (inspection summary)

| Area | Location | Notes |
| --- | --- | --- |
| Shell | `ops-shell.tsx` (primary), `app-shell.tsx` (legacy rooms) | Narrow 6-item nav: Health, Agents, Approvals, Integrations, Slack, Settings |
| Home | `control-plane-dashboard.tsx` → `/api/v1/control-plane/status` | Real readiness + agent/Slack/MCP/Kelpie/Codex health |
| Approvals | `approval-view.tsx` → `/api/v1/approvals` + decisions | Real, org-scoped, capability-gated |
| Agents | `agents-view.tsx` → `/api/v1/agents` | Real readiness directory |
| Connectors | `connector-admin-view.tsx` → `/api/v1/connectors` | Real |
| Tasks | `tasks-view.tsx` → `/api/v1/tasks` | Real coordination tasks |
| Missions | `packages/mcp/src/missions.ts` only | No web API yet |
| Audit | `audit_events` table + MCP observability export | No web list API yet |
| Design tokens | `tokens.css` + `globals.css` | Dark-first Carbon/signal amber — retain |
| UI primitives | `components/ui/*`, `severity.tsx`, `page-header.tsx` | Retain and extend |
| Auth | better-auth session → actor via email (`api-context.ts`) | Org from actor row; no multi-org switcher yet |
| Query cache | `@tanstack/react-query` in `providers.tsx` | Use for all new server state |
| Skill packs | `skills/muster-*` | Map to Capabilities catalogue |

## Components to retain

- Design tokens and anti-hype UI policy tests
- shadcn-style primitives (button, badge, card, avatar)
- `SeverityBadge` vocabulary (extend to unified status system)
- `PageHeader`
- Approval domain service + routes (harden UX only)
- Control-plane status service (feed Command)
- Agent readiness directory
- Connector domain
- Task domain (seed for Operations work queue)
- Auth / `apiSubject` / problem+json pattern
- ADR 0006: no in-app chat product

## Components to replace / supersede

| Current | Replacement |
| --- | --- |
| `OpsShell` narrow nav | `CompanyOsShell` with 10-item Security OS nav |
| Control-plane-only home | Command dashboard (health + attention + activity) |
| Flat approval cards | Governance Inbox with confirmation + rejection reason |
| Ad-hoc `fetch` in views | Typed `lib/api` client + query/mutation hooks |
| Room-centric `CommandPalette` | OS navigation + entity search commands |
| Demo-hardcoded teams/skills in UI | Adapters + fixtures when APIs missing |

## APIs already available

| Endpoint | Capability (typical) | Use |
| --- | --- | --- |
| `GET /api/v1/control-plane/status` | `administration.manage` | Command health / integrations |
| `GET /api/v1/approvals` | `workflows.approve` | Approvals + Command metrics |
| `POST /api/v1/approvals/:id/decisions` | `workflows.approve` + required cap | Approve / reject |
| `GET /api/v1/agents` | `agents.read` | Agents scoreboard / Command |
| `GET /api/v1/agents/:id/readiness` | agents | Agent dossier |
| `GET /api/v1/connectors` | connector admin | Integrations |
| `GET/POST /api/v1/tasks` | tasks | Operations work items |
| `GET /api/v1/health`, `ready` | public-ish readiness | System health indicator |
| `GET /api/v1/events/stream` | realtime | Optional live refresh |
| `GET /api/v1/search` | search | Command palette (scope carefully) |
| `GET /api/v1/hunts` | hunts | Operations category |
| `GET /api/v1/reaction-packs` | admin | Capability packs seed |
| Agent runs / timeline | various | Agent activity |
| Evidence by id | evidence | Approval / audit links |

## APIs missing (add in foundation)

| API | Purpose | Migration? |
| --- | --- | --- |
| `GET /api/v1/session/me` | Actor, organisation, capabilities (no secrets) | No |
| `GET /api/v1/audit/events` | Org-scoped audit feed + filters | No |
| `GET /api/v1/missions` | List governed missions | No |
| `GET /api/v1/missions/:id` | Mission detail | No |
| `GET /api/v1/missions/:id/runs` | Run history | No |
| `GET /api/v1/command/summary` | Aggregated Command metrics from real tables | No |
| Teams / workforce | Not in DB as first-class teams | Fixture adapter only |
| Unified work-item projection | Tasks + hunts + connector issues | Adapter over existing tables |
| Multi-org membership switch | Single actor↔org today | Shell placeholder; no fake multi-tenant |

## Migrations required

**None for foundation.** Use existing tables:

- `organisations`, `actors`, `approvals`, `audit_events`
- `governed_missions`, `governed_mission_runs`
- `agent_definitions`, `agent_runs`, `agent_readiness_snapshots`
- `tasks`, `integration_records`, `connectors` (as already modelled)
- reaction packs / skill packs for capability catalogue metadata

Future (not this pass):

- `teams` / membership tables
- unified `work_items` projection table
- customer portfolio + access ACL tables
- multi-organisation membership for switcher

## Security risks and controls

| Risk | Control |
| --- | --- |
| Cross-org IDOR | Every query filters `subject.organisationId`; never trust browser org id for authz |
| Approval bypass | Decisions only via `ApprovalDomainService.decide`; require reason; capability checks |
| Secret leakage | Never return connector credentials, tokens, encryption keys |
| XSS from connector content | Render external text as text; no `dangerouslySetInnerHTML`; expandable JSON via safe stringify |
| Prompt injection display | Label connector/agent content as untrusted evidence |
| Unsafe external links | `rel="noopener noreferrer"` + explicit SoR label |
| Unbounded audit/JSON | Cap limits (default 50–200); collapse metadata by default |
| CSRF | Same-site session cookies + POST mutations with session (existing better-auth) |
| localStorage authoritative state | Theme preference only; no operational store |
| Capability grant from UI | No silent grants; assignment mutations must hit governed backend (later) |

## Delivery order

1. **Plan** (this doc)
2. **Shell + design system** — status vocabulary, primitives, `CompanyOsShell`, org context, command palette
3. **API layer** — typed client, session/me, audit, missions, command summary
4. **Views** — Command → Approvals → Missions → Agents → Audit → Integrations → Operations → Teams → Capabilities
5. **Tests** — shell/nav, status rendering, approval decision, audit filters, permission-denied
6. **Docs** — PRODUCT/DESIGN + ADR update

## Adapter / fixture policy

- Prefer real APIs always.
- When backend lacks a domain (teams, customer portfolio, unified work categories),
  put data behind `lib/api/adapters/*` with `source: "fixture" | "api"` and
  UI badges when fixture-backed.
- Never scatter fake constants inside feature components.

## Definition of done (foundation)

- [x] Plan written
- [x] Company OS shell + 10-item nav
- [x] Design system status vocabulary unified
- [x] Command uses real control-plane + approvals + agents where authorised
- [x] Approvals usable end-to-end with reason + confirmation
- [x] Missions list/detail from DB
- [x] Audit feed searchable
- [x] Integrations health from connectors/control-plane
- [x] Org context visible; no localStorage domain store
- [x] Build + unit tests green
- [x] PRODUCT/DESIGN/ADR updated
