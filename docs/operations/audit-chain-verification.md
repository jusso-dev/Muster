# Operational runbook: audit chain verification

Muster's `audit_events` table is a hash-chained, append-only log. This runbook
covers running the verifier and interpreting its result. For the attestation
and evidence-custody steps that follow a non-strict result, continue with
[incident-recovery.md](incident-recovery.md#audit-integrity-verification-and-attestation).

**The verifier never writes.** Nothing in this runbook asks you to change an
audit row, and nothing ever should. A hash mismatch is investigated, recorded,
and attested — never "repaired".

## Run it

Verification is scoped to one organisation.

```bash
MUSTER_AUDIT_ORGANISATION_ID=<organisation-uuid> pnpm db:verify-audit
# or
pnpm db:verify-audit --organisation=<organisation-uuid>
```

If you do not know the organisation id, run the command with neither. It lists
the organisations in the connected database and exits `64` without verifying
anything:

```
MUSTER_AUDIT_ORGANISATION_ID is not set and --organisation was not passed.

Usage:
  MUSTER_AUDIT_ORGANISATION_ID=<uuid> pnpm db:verify-audit
  pnpm db:verify-audit --organisation=<uuid>

Organisations in this database:
  018f55d8-c4c7-7c3e-88ef-000000000001  muster
```

The machine-readable JSON report goes to stdout; the operator interpretation
goes to stderr. Capture both:

```bash
pnpm db:verify-audit --organisation=<uuid> >report.json 2>report.txt
```

## Exit codes

| Code | Outcome                        | Meaning                                                                                |
| ---- | ------------------------------ | -------------------------------------------------------------------------------------- |
| `0`  | `strict-valid`                 | Every event rehashes exactly. Nothing to do.                                           |
| `1`  | `invalid`                      | A mismatch no known legacy path explains. Treat as an incident.                        |
| `2`  | `legacy-compatible-not-strict` | Only the known pre-normalisation `approvalId` defect. Strict verification still fails. |
| `64` | —                              | Usage: no organisation id, or not a UUID. Nothing was verified.                        |
| `69` | —                              | The database could not be reached. Nothing was verified.                               |

`64` and `69` are deliberately distinct from `1`: an operator who forgot an
environment variable, and a database that is down, must not page anyone with
"audit chain invalid".

## Interpreting `legacy-compatible-not-strict`

This is the expected result on any workspace that recorded integration actions
before audit metadata normalisation. It is what the homelab reports today, with
strict verification failing at sequence 136.

What happened: `integration.action.queued` / `.succeeded` / `.failed` events
were hashed with `approvalId: undefined` present in their metadata object.
PostgreSQL JSONB drops undefined properties on write, so the stored metadata no
longer contains the key the stored hash was computed over. The event is
authentic; its hash is simply reproducible only by re-adding the omitted
property, which is what `packages/audit`'s legacy compatibility path does.

What it does **not** mean:

- It is not a repair. `historicalChainRepaired` is always `false`.
- It does not make strict verification pass. `strict.valid` stays `false`, and
  the report keeps reporting the failing sequence.
- It is not evidence of tampering by itself — but it also is not a clean bill
  of health, which is why the exit code is not `0`.

Scope check before accepting it: every sequence listed in
`legacyApprovalIdOmissions` must be one of those three integration-action
actions, and the sequence in `strict.brokenAt` must be the first of them. The
verifier enforces this; anything outside that set is reported `invalid`
instead.

Then:

1. Keep `report.json` and `report.txt` with the incident or restore evidence.
2. Record the report time, application revision, command, `strict.brokenAt`,
   and every listed legacy sequence in the recovery attestation described in
   [incident-recovery.md](incident-recovery.md#audit-integrity-verification-and-attestation).
3. State explicitly in that attestation that the result is a compatibility
   reconstruction only and that no audit event was rewritten or removed.

The count of affected sequences is fixed history: it can only stay the same or
be exceeded by a genuinely new defect. If a later run reports a legacy sequence
that was not in the previous run, events are still being written with the old
shape — that is a code regression in the integration-action path, and it is a
bug to fix at the writer, never in the stored rows.

## Interpreting `invalid`

Something rehashes wrong and no known reconstruction explains it. Preserve the
rows exactly as stored, contain writes if warranted, and follow the incident
path in [incident-recovery.md](incident-recovery.md). Do not run any command
that updates audit hashes, metadata, sequences, or outbox history.

## When strict verification will pass again

Never, for a workspace that already holds pre-normalisation events — and that
is correct. Immutable history cannot be made strictly reproducible without
rewriting it. `legacy-compatible-not-strict` is the permanent, honest result
for those workspaces; a workspace bootstrapped after normalisation reports
`strict-valid`.
