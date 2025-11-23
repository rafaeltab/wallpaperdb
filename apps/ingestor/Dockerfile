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
 
RUN turbo prune @wallpaperdb/ingestor --docker
 
FROM build_base AS builder
 
# First install the dependencies (as they change less often)
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
 
# Build the project
COPY --from=pruner /app/out/full/ .
RUN turbo run build

FROM base AS runner

RUN apk update && apk add --no-cache libc6-compat

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 ingestor

WORKDIR /app/apps/ingestor

# Copy built application and dependencies from builder
# Preserve pnpm workspace structure for proper module resolution
COPY --from=builder --chown=ingestor:nodejs /app/apps/ingestor/dist ./dist
COPY --from=builder --chown=ingestor:nodejs /app/apps/ingestor/node_modules ./node_modules
COPY --from=builder --chown=ingestor:nodejs /app/node_modules /app/node_modules

# Copy workspace packages that ingestor depends on (with their node_modules for transitive deps)
COPY --from=builder --chown=ingestor:nodejs /app/packages/core /app/packages/core
COPY --from=builder --chown=ingestor:nodejs /app/packages/events /app/packages/events
COPY --from=builder --chown=ingestor:nodejs /app/packages/url-ipv4-resolver /app/packages/url-ipv4-resolver

USER ingestor

EXPOSE 3000

CMD ["node", "dist/index.mjs"]
