# syntax=docker/dockerfile:1.7

FROM node:26-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm contracts:generate && pnpm build
RUN pnpm deploy --filter=@muster/worker --prod /prod/worker \
    && pnpm deploy --filter=@muster/agent-gateway --prod /prod/agent-gateway \
    && pnpm deploy --filter=@muster/database --prod /prod/database \
    && mkdir -p /workspace/apps/web/.next/standalone/apps/web/.next \
    && cp -R /workspace/apps/web/.next/static /workspace/apps/web/.next/standalone/apps/web/.next/static \
    && cp -R /workspace/apps/web/public /workspace/apps/web/.next/standalone/apps/web/public

FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /workspace/apps/web/.next/standalone ./web
COPY --from=build --chown=nonroot:nonroot /prod/worker ./worker
COPY --from=build --chown=nonroot:nonroot /prod/agent-gateway ./agent-gateway
COPY --from=build --chown=nonroot:nonroot /prod/database ./database
COPY --chown=nonroot:nonroot deploy/docker/runtime ./runtime
COPY --chown=nonroot:nonroot deploy/docker/codex-home /var/lib/muster/codex
EXPOSE 3000 3001 3002
CMD ["/app/runtime/boot-web.mjs"]
