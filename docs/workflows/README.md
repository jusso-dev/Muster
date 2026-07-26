# Workflows

Workflows are versioned YAML with `apiVersion: muster.security/v1` and `kind: Workflow`. Drafts validate before saving; published versions are immutable.

Supported step kinds are `action`, `agent`, `query`, `condition`, `approval`, `delay`, `notification`, `parallel`, `foreach`, and `subworkflow`. Expressions use a bounded property/comparison evaluator—never JavaScript `eval`.

Execution runs in `muster-workflows`. State and step results remain in PostgreSQL; BullMQ jobs contain identifiers and trace metadata. Retries reload authoritative state. Mutation steps bind an approval record and idempotency key. Dry run validates inputs, permissions, conditions, and output schemas without connector side effects.

Use the Monaco editor at `/workflows/:id`; it shows schema state, visual steps, version, trigger, permissions, run history, and approval history.
