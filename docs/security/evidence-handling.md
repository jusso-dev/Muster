# Evidence and retention

Evidence objects remain outside PostgreSQL in a private S3-compatible bucket. PostgreSQL stores organisation, filename, MIME type, size, SHA-256, actor, timestamps, classification, relationships, storage key, scan/quarantine state, retention/legal hold, and object-lock metadata.

Uploads use bounded presigned operations, MIME and size policy, hash validation, and a malware-scan adapter. Downloads are short-lived and audited. Public ACLs and permanent public URLs are prohibited. Untrusted HTML is downloaded or rendered as inert text, never injected.

Organisation retention policies drive asynchronous maintenance. Legal hold and authoritative Kelpie references override normal expiry. Messages and audit records are never hard-deleted. Evidence deletion is prohibited; a retention transition records disposition and preserves metadata/hash.
