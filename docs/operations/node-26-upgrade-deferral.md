# Node 26 runtime upgrade deferral (#34)

Tracker #78 item 10 defers the coordinated Node 26 runtime/type cutover until
product gates for the Hermes MCP pivot are stable.

## Status: deferred

Product gates landed (or in progress) under #78:

- Remote MCP vertical slice (#72)
- Write/proposal tools + approvals
- Operational knowledge (#71)
- Skill packs (#73)
- Observability (#77)
- Governed missions (#76)
- Packaging/admin minimum

The Node 26 matrix in #34 remains blocked until:

1. Node 26 is confirmed as the supported production/LTS target for Muster.
2. Docker build image, distroless runtime, CI, Compose mocks, `engines`, and
   `@types/node` move together with a frozen lockfile.
3. Full `pnpm check`, migrate/bootstrap, unit/integration, Playwright, and
   container security scans pass under Node 26.

Do not merge Dependabot PRs #1 / #8 in isolation.

## Revisit trigger

Open a replacement rollup PR against #34 only after the above gates are green
on Node 24 in production-shaped environments and the support policy is written
down in this document.
