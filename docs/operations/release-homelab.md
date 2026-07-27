# Immutable release and homelab handoff

Release only after the CI quality and container jobs are green. Record the
published `sha-<commit>` tag and OCI digest from the workflow checksum artifact.
The container pipeline builds a single `linux/amd64` application image, emits
SBOM/provenance, scans it with Trivy, and verifies an anonymous GHCR pull after
logout.

On the private homelab, preserve the previous immutable tag before changing
anything:

```bash
grep '^MUSTER_VERSION=' .env.homelab
MUSTER_VERSION=sha-REPLACE-WITH-REVIEWED-COMMIT ./scripts/install-homelab.sh
docker compose --env-file .env.homelab -f deploy/docker/docker-compose.homelab.yml ps
curl --fail http://127.0.0.1:3004/api/v1/health
```

The installer requires an immutable `sha-<commit>` value. It creates a private
administrator only for this homelab and does not seed demo activity. Keep
`MUSTER_PUBLIC_URL` and `AUTH_TRUSTED_ORIGINS` limited to the exact homelab/IP
browser origins. The Codex state volume is retained by Compose; authenticate it
only through the `codex-login` setup profile.

Rollback only after checking migration compatibility and preserving state:

```bash
MUSTER_VERSION=sha-PREVIOUS-REVIEWED-COMMIT ./scripts/install-homelab.sh
```

Do not rollback across an incompatible database migration. Follow
[backup and restore](backup-restore.md) for a stateful recovery, and run the
private homelab login/message/task/Codex smoke suite after any release.
