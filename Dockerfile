# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Build stage — layer order optimised for BuildKit + GHA cache hits.
# Copy lockfiles and package manifests before sources so dependency installs
# reuse cache when only app code changes.
# -----------------------------------------------------------------------------
FROM node:26-bookworm-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1
# Node 26 official slim images no longer ship corepack on PATH by default.
RUN npm install -g corepack@latest && corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps/agent-gateway/package.json apps/agent-gateway/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/agent-harness/package.json packages/agent-harness/
COPY packages/agents/package.json packages/agents/
COPY packages/alerts/package.json packages/alerts/
COPY packages/api-client/package.json packages/api-client/
COPY packages/audit/package.json packages/audit/
COPY packages/auth/package.json packages/auth/
COPY packages/authz/package.json packages/authz/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/event-protocol/package.json packages/event-protocol/
COPY packages/evidence/package.json packages/evidence/
COPY packages/integrations/package.json packages/integrations/
COPY packages/investigations/package.json packages/investigations/
COPY packages/mcp/package.json packages/mcp/
COPY packages/notifications/package.json packages/notifications/
COPY packages/rooms/package.json packages/rooms/
COPY packages/search/package.json packages/search/
COPY packages/test-utils/package.json packages/test-utils/
COPY packages/ui/package.json packages/ui/
COPY packages/workflows/package.json packages/workflows/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

RUN --mount=type=cache,id=turbo,target=/workspace/.turbo \
    pnpm contracts:generate && pnpm build

RUN pnpm deploy --filter=@muster/worker --prod /prod/worker \
    && pnpm deploy --filter=@muster/agent-gateway --prod /prod/agent-gateway \
    && pnpm deploy --filter=@muster/database --prod /prod/database \
    && pnpm deploy --filter=@muster/mcp-server --prod /prod/mcp-server \
    && mkdir -p /workspace/apps/web/.next/standalone/apps/web/.next \
    && cp -R /workspace/apps/web/.next/static /workspace/apps/web/.next/standalone/apps/web/.next/static \
    && cp -R /workspace/apps/web/public /workspace/apps/web/.next/standalone/apps/web/public

# -----------------------------------------------------------------------------
# Runtime — distroless Node 26
# -----------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs26-debian13:nonroot AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /workspace/apps/web/.next/standalone ./web
COPY --from=build --chown=nonroot:nonroot /prod/worker ./worker
COPY --from=build --chown=nonroot:nonroot /prod/agent-gateway ./agent-gateway
COPY --from=build --chown=nonroot:nonroot /prod/database ./database
COPY --from=build --chown=nonroot:nonroot /prod/mcp-server ./mcp-server
COPY --chown=nonroot:nonroot deploy/docker/runtime ./runtime
COPY --chown=nonroot:nonroot deploy/docker/codex-home /var/lib/muster/codex
EXPOSE 3000 3001 3002 3003
CMD ["/app/runtime/boot-web.mjs"]
