# Node runtime support policy

## Supported runtime

Muster's supported production and CI Node.js major is **26**.

| Surface | Policy |
| --- | --- |
| `package.json` `engines.node` | `>=26.0.0` (enforced via `.npmrc` `engine-strict=true`) |
| CI / security workflows | `actions/setup-node` with `node-version: "26"` |
| Docker build stage | `node:26-bookworm-slim` |
| Distroless runtime | `gcr.io/distroless/nodejs26-debian13:nonroot` |
| Compose mock images | `node:26-bookworm-slim` |
| Type definitions | `@types/node` `^26.1.1` (aligned with runtime major) |

Do not advance `@types/node` ahead of the production runtime major, and do not
change only one of Dockerfile / distroless / CI / Compose / engines in isolation.

## Upgrade history

- **#34** — coordinated cutover from Node 24 → Node 26 (Docker, distroless,
  CI, Compose, engines, `@types/node`, lockfile).
- Supersedes Dependabot PRs #1 and #8, which were intentionally not merged alone.

## Rollback

Rollback is the previous GHCR image built from the last Node 24 multi-stage
Dockerfile (`node:24-bookworm-slim` + `gcr.io/distroless/nodejs24-debian13:nonroot`).
Redeploy that digest and restore the matching git revision if a Node 26 image
fails health checks.

## Compatibility gates (release checklist)

- [ ] `pnpm install --frozen-lockfile` on Node 26
- [ ] `pnpm check` (lint, typecheck, test, build)
- [ ] `pnpm db:migrate` / `db:bootstrap` / `db:verify-clean` as applicable
- [ ] Unit + integration suites under Node 26 CI
- [ ] `linux/amd64` image build; web / worker / agent-gateway health
- [ ] `pnpm audit --audit-level high`, licence/SBOM/container scans, CodeQL
