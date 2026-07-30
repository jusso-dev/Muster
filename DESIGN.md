# Muster design system

Muster web is a **Security Company OS** shell: dense, dark-mode-first,
enterprise operations UI. Not a Slack-familiar room workspace. Conversation and
agent personality live in Slack.

Visual interaction model inspiration (navigation, attention queues, governance
inbox — not domain model or simulation): Meridian Company OS patterns. Keep
Muster tokens, authz, and anti-hype rules.

## Tokens

Source tokens live in `tokens.css` and are consumed by `apps/web/app/globals.css`.
Dark is default; light keeps the same hierarchy. Severity, health, operational
state, and approval state always combine icon, text, and colour.

## Status vocabulary (single system)

- **Severity:** informational · low · medium · high · critical
- **Operational state:** queued · running · waiting · blocked · review · completed · failed · cancelled
- **Health:** healthy · degraded · unhealthy · unknown
- **Approval state:** not-required · pending · approved · rejected · expired · cancelled

Primitives: `apps/web/components/status/status-badges.tsx` and `apps/web/types/status.ts`.

## Structure

- Collapsible left navigation (Command, Operations, Missions, Teams, Agents,
  Capabilities, Approvals, Audit, Integrations, Settings)
- Top bar: organisation context, environment, system health, pending approvals,
  command palette (⌘K), theme, user menu
- Main work surface: operational lists, drawers, and governance cards
- No channel list, DMs, or message composer

## Components

- `CompanyOsShell` application chrome: grouped sidebar with an active-row
  indicator, and a top bar carrying organisation context, search (⌘K),
  approvals bell, theme, and the signed-in actor
- `Panel` / `PanelLink` titled dashboard containers
- Metric tiles (value, measured 24h delta, seven-day sparkline),
  empty/error/skeleton states
- `Progress` ratio bar and `components/os/charts.tsx` (sparkline, hourly run
  activity lines, work-status donut) — chart colour comes from tokens and is
  always paired with a legend label
- Approval cards in Governance Inbox
- Work item tables and board mode
- Agent roster / dossier (existing agents views)
- Integration health cards (no secrets)
- Prefer shadcn-style primitives mapped to Muster tokens

Avoid gradients, glassmorphism, neon, generic KPI vanity metrics, cartoon dog
chrome, fake terminal aesthetics, and colour-only state.

## Agent identity

In **Slack**, agents use distinct usernames/icons (Parker / Jessie / Alfie) via
`chat:write.customize`. In **web UI**, agents appear as named rows with status —
never as a chat bubble product.

## Data rules

- Server-backed queries and mutations only for authoritative state
- Trends, sparklines, rates, and chart series are computed from stored rows;
  a tile with no history shows no trend rather than a decorative arrow, and a
  count and the series beneath it must measure the same window
- Theme preference may use localStorage; operational state must not
- Fixture adapters must be labelled `source: fixture` in UI and types
