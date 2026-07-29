# Muster design system

Muster web is a **dense ops control-plane dashboard**, not a Slack-familiar room
workspace. Surfaces: health cards, agent pack status, connector/Slack/MCP wiring,
approvals. Conversation and agent personality live in Slack.

Visual reference for layout patterns (sidebar + header + cards + tables):
[shadcndashboard](https://github.com/shadcndashboard/shadcndashboard) — patterns only;
keep Muster tokens and anti-hype rules. Do not port Blog/Notes/Tickets apps.

## Tokens

Source tokens live in `tokens.css` and are consumed by `apps/web/app/globals.css`.
Dark is default; light keeps the same hierarchy. Severity and health always combine
icon, text, and colour.

## Structure

- Narrow left ops navigation (Health, Agents, Approvals, Integrations, Slack, Settings)
- Top bar: product identity, connection status, theme, sign-out
- Main work surface: dashboard cards or focused admin tables
- No channel list, DMs, or message composer

## Components

- Status cards for readiness dependencies and integrations
- Agent roster rows: name, runtime, Slack exposure, last run, kill switch
- Approvals and connector admin keep compact governed records
- Prefer shadcn-style primitives (card, table, badge, button) mapped to Muster tokens

Avoid gradients, glassmorphism, neon, generic KPI vanity metrics, cartoon dog chrome,
and colour-only state.

## Agent identity

In **Slack**, agents use distinct usernames/icons (Parker / Jessie / Alfie) via
`chat:write.customize`. In **web UI**, agents appear as named rows with status —
never as a chat bubble product.
