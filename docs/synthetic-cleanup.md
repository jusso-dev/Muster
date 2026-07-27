# Synthetic cleanup maintenance

`pnpm --filter @muster/database cleanup:synthetic -- --apply /absolute/manifest.json` is intentionally not a selector or broad deletion tool. Supply an independently reviewed immutable JSON manifest only through the maintenance runner.

The manifest contains one organisation, explicit UUID candidates, table digests, and a SHA-256 digest over every field except `digest`. The runner rejects digest changes and the four protected genuine direct-message IDs.

It uses one serializable transaction. It archives rooms, writes append-only message deletion revisions before hiding proof messages, transitions non-held evidence to `retired` without removing hashes/provenance, rejects selected agent memories, disables selected watchlists, then emits exactly one cleanup audit and outbox event. Audit/outbox rows, evidence metadata, and message history are never deleted.

Object removal needs separate storage evidence after legal-hold and object-lock review; it is deliberately outside this command. Generate candidates from live state, restore-test exact manifest in an isolated PostgreSQL instance, then run with an operator-approved maintenance actor and trace ID.
