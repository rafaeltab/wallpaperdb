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

RUN turbo prune @wallpaperdb/wallpaper --docker

FROM build_base AS builder

COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
RUN turbo run build

FROM base AS runner

RUN apk update && apk add --no-cache libc6-compat

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 user

WORKDIR /app/apps/wallpaper

COPY --from=builder --chown=user:nodejs /app/apps/wallpaper/dist ./dist
COPY --from=builder --chown=user:nodejs /app/apps/wallpaper/node_modules ./node_modules
COPY --from=builder --chown=user:nodejs /app/node_modules /app/node_modules

USER user

EXPOSE 3010

CMD ["node", "dist/index.mjs"]
