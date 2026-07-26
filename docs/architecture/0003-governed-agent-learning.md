# ADR 0003: Governed agent learning

Status: accepted

## Context

Muster agents should learn across runs in the useful sense demonstrated by
Hermes Agent: retaining experience, turning repeated procedures into reusable
skills, searching prior sessions, and refining skills after use. Security
operations evidence is untrusted and frequently contains prompt injection.
Silent mutation of production prompts or permissions is therefore unsafe.

## Decision

Muster implements three distinct learning tiers:

1. Run reflections are ephemeral and never become instructions.
2. Durable learning notes are evidence-linked, organisation-scoped,
   classification-aware, expirable, searchable, and supplied to later runs as
   learned context rather than trusted policy.
3. Procedural skills are immutable, hash-addressed versions. Agents may propose
   a version, but publication requires a deterministic evaluation suite, no
   known regression, capability review, and human approval. Published versions
   can be rolled back without destroying history.

The gateway records an evidence-linked note after every terminal run. Reviewed
runs can submit candidate notes and skill changes through typed, capability-
checked application services. These record provenance to the source run and
evidence and never modify an active skill in place. Retrieval obeys
organisation, classification, and agent boundaries. All proposal, evaluation,
approval, publication, rollback, retirement, and kill-switch actions are audit
events.

The deterministic `muster-agent-security-v1` evaluation rejects instruction
injection, policy bypass language, and any tool or capability expansion beyond
the reviewed agent definition. A proposal creates a pending approval record,
but only a human with `agents.manage` can execute publication. The former
active version remains available for rollback; retirement preserves immutable
version and evaluation history.

Self-authored skills cannot add tools, capabilities, network origins, runtime,
token budget, cost budget, or approval exemptions. Those remain properties of
the reviewed agent definition.

## Consequences

Agents improve from local operational experience while preserving provenance
and reversibility. Promotion is slower than unrestricted self-editing, but a
malicious alert, document, or tool result cannot silently become durable
trusted instruction.
