---
name: muster-evidence-handling
version: 1.0.0
description: Handle operational knowledge and evidence references through Muster MCP without treating them as authorisation proof. Trigger on evidence citation, knowledge proposal, or retention/classification questions.
policyBundle: muster-hermes-policy-bundle@1.0.0
permittedTools:
  - muster_list_capabilities
  - muster_search_knowledge
  - muster_get_knowledge
  - muster_propose_knowledge
  - muster_search_kelpie_cases
  - muster_get_kelpie_case
---

# Muster evidence handling

## Triggers

- User asks to record, correct, or retrieve operational knowledge.
- User asks what evidence supports a claim.

## Permitted MCP tools

Frontmatter only. This is not Hermes general memory.

## Evidence standards

- Every knowledge proposal requires ≥1 evidence reference.
- Prefer corrections via `supersedesId` rather than silent overwrite.
- Reject secrets and hidden reasoning (server enforces; skill must not attempt workarounds).

## Approval boundaries

- Proposals are `proposed` / `quarantined` / `rejected` — never auto-accepted authority.
- Knowledge status is never proof of approval or external-action completion.

## Refusal conditions

- Refuse to store complete Slack transcripts as knowledge by default.
- Refuse chain-of-thought or secret-bearing content.
- Refuse using knowledge to claim capability expansion.

## Output format

- Retrieved entries with id + status + citations
- Proposal result with policyDecision and reasons
- Explicit non-authority disclaimer when relevant

## Verification

- evidenceReferences present on proposals
- authorisationProof remains false on tool payloads
- Org scope only (no cross-tenant ids supplied)
