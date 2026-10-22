FROM node:22.22.3-alpine AS base

WORKDIR /app

FROM base AS build_base 

RUN apk update && apk add --no-cache libc6-compat

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

COPY package.json ./
RUN corepack enable && corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate

RUN pnpm install -g "turbo@$(node -p 'require("./package.json").devDependencies.turbo')"

FROM build_base AS pruner

COPY . .
 
RUN turbo prune @wallpaperdb/asset --docker
 
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
RUN adduser --system --uid 1001 asset

WORKDIR /app/apps/asset

# Copy built application and dependencies from builder
# Preserve pnpm workspace structure for proper module resolution
COPY --from=builder --chown=asset:nodejs /app/apps/asset/dist ./dist
COPY --from=builder --chown=asset:nodejs /app/apps/asset/node_modules ./node_modules
COPY --from=builder --chown=asset:nodejs /app/node_modules /app/node_modules

USER asset

EXPOSE 3000

CMD ["node", "dist/index.mjs"]
