# Synthetic cleanup maintenance

This runner archives or retires an exact, independently reviewed set of
synthetic records. It is not a selector and has no broad-delete mode.

## Safety contract

- One organisation per manifest. Every query and mutation is organisation
  scoped.
- Every candidate must have an exact, pre-existing row in the append-only
  `synthetic_artifact_provenance` registry. Human-readable names and
  idempotency-key text are never cleanup proof. Record provenance when a seed,
  mock run, or test fixture creates the artifact; legacy live-proof provenance
  requires its own reviewed database change before cleanup capture.
- Authenticated `capture` locks the exact candidate and provenance rows,
  records their live SHA-256 table digests, then returns the complete
  digest-bound manifest.
- `verify` fails if any candidate is missing, cross-organisation, changed
  after capture, already archived, or otherwise protected.
- The maintenance actor must be an active human with
  `administration.manage`.
- The authenticated approval-request action creates an expiring
  `maintenance.synthetic-cleanup` approval bound to the exact manifest digest.
  Apply requires an independent approver, current approver capability, and the
  unchanged live pre-state.
- Capture, verify, approval request, and apply require an authenticated web
  session whose organisation, actor, and `administration.manage` capability
  match the manifest. There is no plan-derived CLI identity.
- The four explicitly protected genuine messages can never be selected. No
  direct room, direct-room message, or direct-room member can be archived,
  redacted, or retired by this workflow.
- Legal-held, object-locked, already-retired, and stale evidence fails the
  whole transaction. Unversioned and versioning-suspended `null` objects are
  rejected because they cannot be deleted without a replacement-object race.
  Nothing is silently skipped.
- Rooms and top-level product records are archived. Messages receive an
  append-only deletion revision before redaction. Evidence metadata and hashes,
  execution events/sources, audit, and outbox history remain intact.
- Exact affected-row counts are asserted. One serializable transaction writes
  state changes, executed approval, immutable cleanup receipt, audit, and
  outbox.
- Cleanup receipts are protected by a database trigger against update/delete.
  Object-deletion attempts are append-only too. Replaying the same manifest
  returns the receipt and recorded outcomes without deleting objects again.

## Procedure

1. Capture a PostgreSQL custom-format backup and SHA-256 digest. Inventory each
   selected evidence object by bucket, key, version, ETag, size, SHA-256, legal
   hold, and object-lock state. The inventory must cover selected evidence
   one-to-one.
2. Restore the backup into isolated PostgreSQL with no worker, outbox consumer,
   or object-store credentials. Apply the exact application revision's
   migrations.
3. Build an unsigned version-2 plan with explicit UUID arrays,
   `selectionEvidence`, and `objectStorageObjects`. Supply fresh `manifestId`
   and `approvalId` values.
4. Through an authenticated administrator session, POST
   `{"mode":"capture","payload":<plan>}` to
   `/api/v1/maintenance/synthetic-cleanup`. Save and review the returned full
   manifest and digest. Never derive an administrator identity from plan JSON.
5. POST `{"mode":"verify","payload":<manifest>}` and then
   `{"mode":"request_approval","payload":<manifest>}` to
   `/api/v1/maintenance/synthetic-cleanup`. Have a different authorised
   administrator decide the request through the normal approvals workflow.

6. In the isolated restore, apply the approved manifest. Assert exact receipt
   counts/digests; protected, cross-organisation, bootstrap, and held rows
   remain unchanged; the original audit chain only gains requested/applied
   events.
7. Restore the original backup into a second isolated database and prove its
   baseline counts/digests match the pre-cleanup inventory. Discard both
   isolated environments.
8. Repeat capture and approval against live state only if unchanged. Apply by
   posting `{"mode":"apply","payload":<manifest>}` to the authenticated
   maintenance endpoint.

9. Apply commits an idempotent `muster-maintenance` outbox event. The worker,
   never the HTTP handler, reloads the immutable receipt and executed approval,
   rechecks each exact object version, deletes only receipt-listed immutable
   versions, downloads the exact version and verifies its SHA-256, records
   append-only started/succeeded/failed outcomes bound to that approval, and
   verifies each version is absent after deletion. A missing version fails the
   initial job unless the same approval already recorded `started`; this
   distinguishes crash recovery from an object that was never verified.
   Receipt replays never enqueue deletion. For a failed/crashed deletion, POST
   `{"mode":"request_object_deletion_retry","payload":{"manifest":<manifest>,"retryApprovalId":"<fresh UUID>"}}`;
   after a different active administrator approves that exact pending-version
   digest, POST the same payload with mode `retry_object_deletion`. This
   transaction consumes the approval and queues a new durable worker job.
   Missing versions are then recorded as `observed_missing`; present versions
   are rechecked and deleted by exact immutable version ID. Refuse held/locked
   objects; never infer keys from prefixes.
10. Capture after-counts and a second backup/digest. Restart PostgreSQL, Redis,
    MinIO, web, worker, and gateway. Verify health, real login, the four genuine
    messages, and all three real agent replies.

The manifest and receipt contain metadata, never object contents or
credentials. Use synthetic data in tests and documentation.
