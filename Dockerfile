# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# --- ops API (Mastra + connectors) ---
FROM base AS ops-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/ops/package.json packages/ops/
COPY apps/ops/package.json apps/ops/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --filter @muster/ops --filter @muster/ops-app --frozen-lockfile || \
  pnpm install --filter @muster/ops --filter @muster/ops-app

FROM base AS ops
COPY --from=ops-deps /app /app
COPY packages/ops packages/ops
COPY apps/ops apps/ops
COPY package.json pnpm-workspace.yaml ./
ENV NODE_ENV=production
ENV MUSTER_OPS_PORT=3010
EXPOSE 3010
WORKDIR /app/apps/ops
CMD ["pnpm", "exec", "tsx", "src/index.ts"]

# --- optional thin status web ---
FROM base AS web-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --filter @muster/web --frozen-lockfile || \
  pnpm install --filter @muster/web

FROM base AS web-build
COPY --from=web-deps /app /app
COPY apps/web apps/web
COPY package.json pnpm-workspace.yaml ./
WORKDIR /app/apps/web
RUN pnpm exec next build

FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
