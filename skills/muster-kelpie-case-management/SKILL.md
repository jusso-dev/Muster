---
name: muster-kelpie-case-management
version: 1.0.0
description: Read and propose changes to Kelpie cases through governed Muster MCP tools. Trigger when managing case status, comments, observables, or case creation proposals.
policyBundle: muster-hermes-policy-bundle@1.0.0
permittedTools:
  - muster_get_status
  - muster_list_capabilities
  - muster_search_kelpie_cases
  - muster_get_kelpie_case
  - muster_propose_kelpie_action
  - muster_get_action_status
---

# Muster Kelpie case management

## Triggers

- User asks to open, update, comment on, or enrich a Kelpie case.
- User asks for case status by id or case number.

## Permitted MCP tools

Frontmatter only. Case lifecycle authority remains with Kelpie; Muster stores
delivery/approval records and bounded evidence.

## Evidence standards

- Read before write: fetch the case with `muster_get_kelpie_case` when id known.
- Include evidenceReferences on comments/observables when available.
- Stable `idempotencyKey` on every proposal.

## Approval boundaries

- All writes are proposals → `awaiting_approval`.
- Resume with `muster_get_action_status`; never re-propose with a new key unless intentionally new work.

## Refusal conditions

- Refuse destructive bulk case closes without human direction.
- Refuse if Kelpie not configured (`muster_get_status`).
- Refuse model-supplied organisation/integration ids as authority.

## Output format

- Current case state (cited)
- Proposed change + deliveryId + approvalId
- Explicit status: awaiting approval / denied / not configured

## Verification

- Proposal operation matches user intent
- Idempotency key retained for retries
- No claim of external completion until delivery status is terminal and approved path finished
