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
# BuildKit --parents keeps apps/foo/package.json layout for the workspace.
COPY --parents apps/*/package.json packages/*/package.json ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

RUN --mount=type=cache,id=turbo,target=/workspace/.turbo \
    pnpm contracts:generate && pnpm build

RUN pnpm deploy --filter=@muster/worker --prod /prod/worker \
    && pnpm deploy --filter=@muster/agent-gateway --prod /prod/agent-gateway \
    && pnpm deploy --filter=@muster/database --prod /prod/database \
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
COPY --chown=nonroot:nonroot deploy/docker/runtime ./runtime
COPY --chown=nonroot:nonroot deploy/docker/codex-home /var/lib/muster/codex
EXPOSE 3000 3001 3002
CMD ["/app/runtime/boot-web.mjs"]
