FROM node:22-alpine AS base

WORKDIR /app

FROM base AS build_base

RUN apk update && apk add --no-cache libc6-compat

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

RUN pnpm install -g turbo@^2

FROM build_base AS pruner

RUN pnpm install -g turbo@^2
COPY . .

RUN turbo prune @wallpaperdb/tags --docker

FROM build_base AS builder

COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
RUN turbo run build

FROM base AS runner

RUN apk update && apk add --no-cache libc6-compat

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 user

WORKDIR /app/apps/tags

COPY --from=builder --chown=user:nodejs /app/apps/tags/dist ./dist
COPY --from=builder --chown=user:nodejs /app/apps/tags/node_modules ./node_modules
COPY --from=builder --chown=user:nodejs /app/packages/core/node_modules ./node_modules
COPY --from=builder --chown=user:nodejs /app/node_modules /app/node_modules

USER user

EXPOSE 3008

CMD ["node", "dist/index.mjs"]
