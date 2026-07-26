# Muster design system

Muster uses a dense, Slack-familiar room workspace: carbon/slate surfaces, signal-amber actions, teal agent identity, compact ruled records, semantic severity labels, and technical values in JetBrains Mono. The interface prioritises channel conversation and causal history over dashboards or standalone alert and case browsers.

## Tokens

Source tokens live in `tokens.css` and are consumed by `apps/web/app/globals.css`. Dark is default; light retains the same information hierarchy. Severity always combines icon, text, and colour.

## Structure

- 224px room navigation with workspace identity, quick links, starred channels, channels, and direct messages
- route-aware main work surface
- optional 320px investigation, room-details, or thread panel
- top search and operational status bar

At tablet widths the context panel becomes a drawer. At mobile widths, navigation becomes a drawer and records become stacked. Touch targets stay at least 36px; focus is visible; reduced-motion preferences disable nonessential transitions.

## Components

Messages remain lightweight. Alerts, findings, approvals, workflow/agent progress, case changes, and evidence appear as distinct compact records inside rooms. Agents join the same direct-message and membership model as humans, using named avatars, `Agent` labels, runtime/status/tool context, confidence, and review state—never a generic robot emoji.

Avoid gradients, glassmorphism, neon cyberpunk, generic executive dashboards, decorative hero copy, excessive rounding, and colour-only state.
