# Muster Product Context

## Register

product

## Users

Muster serves security operators, administrators, and trusted agent runtimes.
Humans configure and govern; agents act under policy. Analysts chat with agents
in **Slack** (or Hermes), not in the Muster web app.

## Product Purpose

Muster is the **governed control plane** for security operations agents.

It owns installation credentials, approvals, audit, missions, operational
knowledge, Slack agent harness delivery, and governed connectors to upstream
products (Kelpie, Tawny, UniFi, …). PostgreSQL is authoritative; Redis/BullMQ
are execution infrastructure.

**Chat is not the product.** Conversation happens in:

- **Slack** — Muster bot exposes Parker, Jessie, and Alfie
- **Hermes** — sessions/models; calls Muster over remote MCP

**Kelpie** remains formal case system of record. Muster does not replace SIEM,
EDR, SOAR, or case management.

Tagline: Governed agents for security ops.

## Agent pack (Australian dog names)

| Agent | Vibe | Helps with |
| --- | --- | --- |
| **Parker** | Border Collie — focused ops lead | Executive/ops briefs, Kelpie case summaries (default Slack agent) |
| **Jessie** | Border Collie — hunter | Tawny hosts, UniFi traffic, bounded hunts |
| **Alfie** | Bearded Collie — researcher | Threat research, feeds, evidence-backed briefs |

Address in Slack: `Hey Jessie …`, `talk to Alfie …`, bare message → Parker.

## Brand Personality

Credible, utilitarian, restrained. Calm under pressure, precise about state and
authority. Direct, evidence-led language. Agents sound human and keen in Slack;
the web UI stays dense and operational.

## Anti-references

- Generic admin-template reskins and decorative executive dashboards
- Neon cyberpunk / Matrix treatments
- Cartoon mascots or robot emoji as agent identity in product chrome
- AI sparkle iconography and hype-heavy autonomy claims
- Slack branding or copied proprietary assets
- Interfaces that blur mocks, recommendations, approvals, and executed actions
- A second chat product inside Muster web

## Design Principles

1. Web UI answers: is the control plane healthy and wired?
2. Dangerous actions stay capability-checked and approval-gated.
3. Evidence and provenance stay explicit; connector content is untrusted.
4. Prefer boring, readable ops UI over novelty.
5. Chat and investigation conversation stay in Slack/Hermes/Kelpie where they belong.

## Accessibility & Inclusion

Target WCAG 2.2 AA where practical. Keyboard navigation, visible focus, semantic
structure, reduced motion, high contrast, non-colour-only status. Desktop primary.
