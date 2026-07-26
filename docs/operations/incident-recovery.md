# Muster incident recovery

If Muster itself is suspected compromised: activate the agent kill switch; block connector egress; revoke API/OIDC/agent runtime credentials; preserve PostgreSQL, object versions, logs, and audit exports; and continue authoritative response in Kelpie/Tawny/Bower.

Validate audit chains and compare connector delivery logs to authoritative product timelines. Rotate secrets before restoring service. Reprocess only undispatched or reconciled idempotency keys. Never replay response actions from raw queue data.

Document containment, evidence custody, restoration point, tenant impact, and any audit-chain gap in the authoritative incident case.
