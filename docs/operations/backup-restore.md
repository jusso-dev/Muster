# Backup and restore

Back up PostgreSQL with point-in-time recovery and the evidence bucket with versioning/object lock. Redis is rebuildable execution infrastructure; retain it only for operational continuity. Back up deployment configuration and secret references separately.

Restore order:

1. isolate writes and snapshot current failed state
2. restore PostgreSQL to a consistent point
3. restore/version evidence objects and validate sampled SHA-256 hashes
4. start Redis, then worker/gateway, then web
5. reconcile undispatched outbox rows and connector delivery records
6. verify audit hash chains, tenant-boundary probes, health, search, and a no-side-effect workflow dry run

Run restore exercises quarterly. Record recovery-point and recovery-time results without including sensitive evidence.
