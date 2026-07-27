# Immutable release and homelab handoff

Release only after CI quality, security, and container jobs are green. Record
the published full `sha-<40-hex-commit>` tag, OCI digest, SBOM, provenance, and
`SHA256SUMS` from the release artifact. The container pipeline builds one
`linux/amd64` application image, scans it with Trivy, and verifies an anonymous
GHCR pull after logout.

The container job has an explicit `needs: quality` dependency. It pushes only a
run-scoped staging tag, then performs Trivy, SBOM, checksum, attestation, and OCI
platform verification against that digest. It also logs out and proves the
run-scoped staging tag is anonymously pullable before promotion. The security
workflow is reusable: CI invokes it for the same commit, while its own weekly
schedule remains available. A separate promotion job needs both the verified
container and same-commit security jobs before creating release tags.

Full-SHA and version tags are write-once. Promotion creates either tag only
when absent, does nothing when it already resolves to the verified digest, and
fails when it resolves elsewhere. A serialized preflight checks every release
tag before mutation. Only `latest` may move to a newer verified digest.

Before the first release, make the GitHub Container Registry package public in
its package settings. CI deliberately logs out before pulling; it fails until
anonymous users can pull the package. Do not treat a successful authenticated
pull as this gate.

On the private homelab, preserve the previous immutable tag before changing
anything:

```bash
grep '^MUSTER_VERSION=' .env.homelab
MUSTER_VERSION=sha-REPLACE-WITH-REVIEWED-FULL-COMMIT ./scripts/install-homelab.sh
docker compose --env-file .env.homelab -f deploy/docker/docker-compose.homelab.yml ps
curl --fail http://127.0.0.1:3004/api/v1/health
curl --fail http://127.0.0.1:3004/api/v1/ready
```

`/health` is liveness: it only proves the web process can reach PostgreSQL.
`/ready` is a serving-readiness gate: it reports PostgreSQL, Redis/queue,
object storage, and the configured agent gateway without exposing endpoints or
credentials. Any unavailable required dependency returns HTTP 503.

The installer requires a full immutable `sha-<40-hex-commit>` tag. It writes
the provided tag into `.env.homelab`, so upgrade and rollback commands cannot
silently retain an old tag. It creates a private administrator only for this
homelab, prints its password only when generated, and does not seed demo
activity. Keep `MUSTER_PUBLIC_URL` and `AUTH_TRUSTED_ORIGINS` limited to exact
IP and `homelab` browser origins; pass both variables explicitly if deployment
uses a different approved pair.

Upgrade and rollback preserve the existing public URL, HTTP port, and trusted
origins unless each value is explicitly supplied. This prevents an immutable
tag change from silently resetting a non-default homelab address.

The private `codex-state` volume survives application upgrades and rollback.
Authenticate it only through the setup profile; never copy, publish, or log
`auth.json`:

```bash
docker compose --env-file .env.homelab -f deploy/docker/docker-compose.homelab.yml \
  --profile setup run --rm codex-login
docker compose --env-file .env.homelab -f deploy/docker/docker-compose.homelab.yml \
  exec -T agent-gateway /nodejs/bin/node -e \
  'fetch("http://127.0.0.1:3002/ready").then((r) => r.json()).then(({ authenticated, status }) => console.log({ authenticated, status }))'
```

After the gateway reports `authenticated: true`, run the private Chromium smoke
suite with injected private credentials and no captured artifacts. It covers
login, message send, task creation, and the configured agent runtime; do not
put those values in source control or shell history:

```bash
MUSTER_BASE_URL=http://homelab:3004 MUSTER_HOMELAB_CRITICAL=true \
MUSTER_CAPTURE_ARTIFACTS=false MUSTER_LOCAL_ADMIN_EMAIL=... \
MUSTER_LOCAL_ADMIN_PASSWORD=... MUSTER_SECONDARY_EMAIL=... \
MUSTER_SECONDARY_PASSWORD=... pnpm test:e2e:homelab --project=chromium
```

Rollback only after checking migration compatibility and preserving state:

```bash
MUSTER_VERSION=sha-PREVIOUS-REVIEWED-FULL-COMMIT ./scripts/install-homelab.sh
```

Do not rollback across an incompatible database migration. Follow
[backup and restore](backup-restore.md) for a stateful recovery, and run the
private homelab login/message/task/Codex smoke suite after any release.
