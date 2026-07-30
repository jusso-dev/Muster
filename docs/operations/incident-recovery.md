# Muster incident recovery

If Muster itself is suspected compromised: activate the agent kill switch; block connector egress; revoke API/OIDC/agent runtime credentials; preserve PostgreSQL, object versions, logs, and audit exports; and continue authoritative response in Kelpie/Tawny/Bower.

Validate audit chains and compare connector delivery logs to authoritative product timelines. Rotate secrets before restoring service. Reprocess only undispatched or reconciled idempotency keys. Never replay response actions from raw queue data.

Document containment, evidence custody, restoration point, tenant impact, and any audit-chain gap in the authoritative incident case.

## Audit integrity verification and attestation

Verify one organisation at a time after a restore or integrity incident:

```bash
MUSTER_AUDIT_ORGANISATION_ID=<organisation-uuid> pnpm db:verify-audit
```

The command emits an operator-visible JSON report and does not write, repair,
delete, or otherwise alter audit history. It exits `0` only for
`strict-valid`, `2` for `legacy-compatible-not-strict`, and `1` for `invalid`;
`64` and `69` mean nothing was verified (missing organisation id, unreachable
database). Running it, finding the organisation id, and interpreting each
outcome are covered in
[audit-chain-verification.md](audit-chain-verification.md).

`legacy-compatible-not-strict` identifies only the known historical defect:
an integration-action event was hashed before PostgreSQL JSONB omitted an
`approvalId: undefined` property. The report proves that specific legacy hash
is reproducible, but strict verification remains failed. It is not a repair,
does not make the historical chain strictly valid, and must never be presented
as one.

For either non-strict result:

1. Preserve the original report, the immutable database backup, and the
   affected organisation ID with the incident evidence.
2. Record report time, application revision, verification command, strict
   failure sequence, and any listed legacy sequence in an approval-backed
   recovery attestation.
3. For `legacy-compatible-not-strict`, state that the result is a
   compatibility reconstruction only; no audit event or outbox event was
   rewritten or removed.
4. For `invalid`, treat the mismatch as unexplained: contain writes as needed,
   export the affected rows/evidence, investigate source and backup lineage,
   and obtain explicit incident approval before restoring service.
5. Attach the report and approval record to the authoritative incident case.

Never update audit hashes, metadata, sequences, or outbox history merely to
make verification green. Audit history is append-only and immutable.
