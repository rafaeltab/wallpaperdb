# Plan: Git Worktree Support (v3)

Run the WallpaperDB monorepo in multiple git worktrees simultaneously with full isolation, a single ingress port per worktree, and fully automated setup.

**Supersedes:** `worktree-support_v2.md`. This version retains all design decisions and technical details from v2 but restructures the work into 12 small, independently verifiable phases. Each phase can be implemented, tested, and committed before moving to the next.

## Status: Phase 12 Complete

---

## Why v3?

v2 is a correct and thorough plan, but it's a monolithic document. Handing it to an agent (or a developer) as a single unit of work risks:

- 5+ hours of work before discovering a fundamental issue
- No rollback points — a failure in phase 8 means re-doing phases 1–7
- No way to verify partial progress

v3 keeps all v2 design decisions intact and simply orders the work into phases with explicit verification steps. Each phase is small enough for one agent session (~30–60 min) and has a clear "done" criteria.

---

## Design Decisions

All design decisions from v2 are retained unchanged. See `worktree-support_v2.md` → "Design Decisions" for the full table. Key decisions summarized:

| Concern | Decision |
|---|---|
| Slot assignment | Auto-assigned sequential integer in `.git/worktrees/<name>/worktree-slot`. `main` = slot 0. |
| Port scheme | Base `8000 + slot * 10`. Offset +0 = Caddy ingress. +1 through +7 = infra host ports. |
| Ingress | Caddy container with path-prefix routing. One exposed host port per worktree. |
| Docker project name | `wallpaperdb-<branch-slug>`, max 63 chars. Full volume/network/container isolation. |
| Hot reload | `docker compose watch` syncs source → `tsx watch` reloads inside container. |
| `node_modules` | Baked into image. Entrypoint re-runs `pnpm install` if lockfile changed. |
| Vite sub-path | `base` as top-level Vite option. TanStack Router `basepath` configured. |
| Variant URLs | `MEDIA_SERVICE_URL` = browser-reachable `http://localhost:<INGRESS_PORT>/media`. |
| Turborepo | Stays on host. Each app's `dev` script becomes `docker compose watch <service>`. |
| Migrations | Auto-run in entrypoint for ingestor + media containers. |
| NATS streams | Automated via `nats-setup` one-shot service, idempotent. |
| Docs app | Excluded from containerization. Runs on host via `make docs-dev`. |

For full details on port allocation, routing table, MEDIA_SERVICE_URL fix, and known risks, see v2.

---

## Phase Overview

| # | Phase | Changes | Verification |
|---|---|---|---|
| 1 | [Bug fixes](#phase-1-bug-fixes) ✅ | Fix port defaults, AGENTS.md | `make check-types`, manual inspection |
| 2 | [Worktree slot assignment](#phase-2-worktree-slot-assignment) ✅ | `setup-worktree.mjs`, postinstall, .gitignore | `pnpm install` → `.worktree` file correct |
| 3 | [Dynamic infra ports](#phase-3-dynamic-infra-ports) ✅ | docker-compose.yml, infra/.env.example | `make infra-start` works, ports match `.worktree` |
| 4 | [Makefile worktree-aware](#phase-4-makefile-worktree-aware) ✅ | Makefile overhaul | All `make` targets work |
| 5 | [NATS stream automation](#phase-5-nats-stream-automation) ✅ | nats-setup service | `make infra-start` → streams exist |
| 6 | [App Dockerfiles + entrypoint](#phase-6-app-dockerfiles--entrypoint) ✅ | 5× Dockerfile.dev, entrypoint.sh | `docker build` succeeds for each app |
| 7 | [App compose file](#phase-7-app-compose-file) ✅ | docker-compose.apps.yml | `docker compose build` succeeds |
| 8 | [Caddy ingress](#phase-8-caddy-ingress) ✅ | Caddyfile, compose integration, admin UI sub-paths | Caddy starts, routes resolve |
| 9 | [Web sub-path support](#phase-9-web-sub-path-support) ✅ | vite.config.ts, App.tsx, wallpaper-share.ts | Web loads at `/web`, links work |
| 10 | [App .env generation](#phase-10-app-env-generation) ✅ | Extend setup-worktree.mjs | Generated .env files have Docker service names |
| 11 | [Dev script switchover](#phase-11-dev-script-switchover) ✅ | App package.json, turbo.json, check-infra.sh | `make dev` starts all containers, hot reload works |
| 12 | [Teardown + cleanup](#phase-12-teardown--cleanup) ✅ | teardown-worktree.mjs, stale detection | `make worktree-remove` cleans up completely |

---

## Phase 1: Bug Fixes

**Goal:** Fix existing bugs that v2 identified. These are independent of worktree support and should be done first so they don't get lost in the larger changes.

**Why first:** These are tiny, zero-risk changes. Getting them out of the way means the remaining phases only touch worktree-related code.

### Changes

1. **`apps/variant-generator/src/config.ts`** — Change default port from `3004` to `3006`. Currently collides with gateway's default port.

2. **`AGENTS.md`** — Fix port numbers in "Production Services" section:
   - Media: `Port 3002` → `Port 3003` (3002 is docs/Fumadocs)
   - Gateway: `Port 3000` → `Port 3004` (3000 is Grafana)
   - Variant Generator: `Port 3004` → `Port 3006`

### Verification

```bash
make check-types          # No type errors introduced
grep -n "3006" apps/variant-generator/src/config.ts   # Port default is 3006
grep "Port 3003" AGENTS.md   # Media port correct
grep "Port 3004" AGENTS.md   # Gateway port correct
grep "Port 3006" AGENTS.md   # Variant Generator port correct
```

### Backwards Compatibility

Fully backwards compatible. No behavior change unless variant-generator is started without a `PORT` env var (which would now correctly default to 3006 instead of colliding with gateway).

---

## Phase 2: Worktree Slot Assignment

**Goal:** Create the worktree detection and slot assignment script. After this phase, `pnpm install` automatically generates a `.worktree` file with the correct slot, project name, and port assignments.

**Why now:** This is the foundational script that everything else depends on. It produces the `.worktree` file that the Makefile, Docker Compose, and .env generation all read from.

### Changes

1. **Create `scripts/setup-worktree.mjs`** — The postinstall script. Must be idempotent.
   - Detect worktree vs main checkout (`.git` is a file → worktree; directory → main)
   - For main: slot = 0. For linked worktrees: read existing slot from `.git/worktrees/<name>/worktree-slot` or assign lowest unclaimed integer ≥ 1
   - Derive branch slug: replace `/` with `-`, strip non-alphanumeric (except `-`), truncate so `wallpaperdb-<slug>` ≤ 63 chars
   - Detect slug collisions (warn if two worktrees produce same project name)
   - Compute ports from slot (base = `8000 + slot * 10`, offsets per v2 port table)
   - Write `.worktree` file (Make-compatible `KEY=VALUE` format)
   - Print summary: slot, ingress port, project name
   - **Stale slot detection:** scan all slot files, warn if any reference nonexistent worktree paths

   The `.worktree` file format:
   ```
   WORKTREE_SLOT=1
   COMPOSE_PROJECT_NAME=wallpaperdb-feat-my-feature
   INGRESS_PORT=8010
   POSTGRES_HOST_PORT=8011
   MINIO_API_HOST_PORT=8012
   NATS_HOST_PORT=8013
   REDIS_HOST_PORT=8014
   OPENSEARCH_HOST_PORT=8015
   OTEL_HTTP_HOST_PORT=8016
   OTEL_GRPC_HOST_PORT=8017
   ```

2. **Root `package.json`** — Add `"postinstall": "node scripts/setup-worktree.mjs"`

3. **`.gitignore`** — Add `.worktree`

4. **Check Docker Compose version** — The script should verify `docker compose version` is ≥ 2.22 (required for `docker compose watch` in later phases). Print a warning if not met, but don't fail — it's not needed yet.

### Verification

```bash
pnpm install
# Should print: "Worktree slot 0 assigned. Ingress: http://localhost:8000"
cat .worktree
# Should contain WORKTREE_SLOT=0, COMPOSE_PROJECT_NAME=wallpaperdb, INGRESS_PORT=8000, etc.

# Verify idempotency:
pnpm install
cat .worktree
# Same values as before

# Verify slot file:
# For main checkout: no .git/worktrees directory needed
# For a linked worktree: check .git/worktrees/<name>/worktree-slot contains the slot number
```

### Backwards Compatibility

Fully backwards compatible. The `.worktree` file is gitignored and nothing reads it yet.

---

## Phase 3: Dynamic Infra Ports

**Goal:** Make `infra/docker-compose.yml` use environment variables for all host port mappings and container names, so each worktree gets isolated infrastructure.

**Why now:** With the slot assignment in place, we can now parameterize the infrastructure. This phase keeps current defaults so everything works without `.worktree`.

### Changes

1. **`infra/docker-compose.yml`:**
   - **Remove all 9 `container_name:` fields** — Docker Compose auto-prefixes with project name
   - **Replace hardcoded port mappings** with env-var-driven ports (with current values as defaults for backwards compat):
     ```yaml
     postgres:
       ports:
         - "${POSTGRES_HOST_PORT:-5432}:5432"
     minio:
       ports:
         - "${MINIO_API_HOST_PORT:-9000}:9000"
       # REMOVE 9001:9001 (Console will go through Caddy in phase 8)
     opensearch:
       ports:
         - "${OPENSEARCH_HOST_PORT:-9200}:9200"
       # REMOVE 9600:9600
     nats:
       ports:
         - "${NATS_HOST_PORT:-4222}:4222"
       # REMOVE 8222:8222
     pgadmin:
       # REMOVE ports: 5050:80 entirely
     redis:
       ports:
         - "${REDIS_HOST_PORT:-6379}:6379"
     lgtm:
       ports:
         - "${OTEL_HTTP_HOST_PORT:-4318}:4318"
         - "${OTEL_GRPC_HOST_PORT:-4317}:4317"
       # REMOVE 3000:3000
     opensearch-dashboards:
       # REMOVE ports: 5601:5601 entirely
     ```
   - **Update network:**
     ```yaml
     networks:
       default:
         name: ${COMPOSE_PROJECT_NAME:-wallpaperdb}_network
     ```

2. **`infra/.env.example`** — Replace with worktree-aware version (see v2 for full contents). Remove gateway-specific config that belongs in `apps/gateway/.env.example`.

3. **Extend `scripts/setup-worktree.mjs`** — Add `.env` file generation for `infra/.env`:
   - Copy from `infra/.env.example`
   - Override dynamic port vars with values from the slot computation
   - Add `COMPOSE_PROJECT_NAME`

### Verification

```bash
pnpm install                  # Regenerates .worktree + infra/.env
cat infra/.env                # Should have POSTGRES_HOST_PORT, INGRESS_PORT, etc.
make infra-start              # Should still work (defaults match current ports)
docker ps --format '{{.Names}}'  # Container names should be prefixed with project name, NOT hardcoded "wallpaperdb-*"
docker ps --format '{{.Ports}}'  # Ports should match .worktree values

# Verify no port conflicts with default values:
# Slot 0: postgres=8001, minio=8002, etc. (or fallback defaults=5432, 9000, etc.)
make infra-stop
```

**Important:** After this phase, admin UIs that had dedicated host ports (Grafana :3000, MinIO Console :9001, pgAdmin :5050, OpenSearch Dashboards :5601, NATS monitoring :8222) are **no longer directly accessible**. They will be restored via Caddy in Phase 8. This is acceptable because:
- The core infrastructure (postgres, minio S3 API, NATS client, redis, opensearch API, OTEL) still has host ports
- Admin UIs are optional during development
- Phase 8 will restore access via Caddy sub-paths

### Backwards Compatibility

Partially backwards compatible. The default port values in docker-compose.yml match the current hardcoded values, so `make infra-start` works without `.worktree`. However, admin UI ports are removed — developers who access Grafana/pgAdmin/etc. directly will need to wait for Phase 8 (Caddy).

**Mitigation:** Keep the removed port mappings commented out in docker-compose.yml with a note: "Uncomment for direct access without Caddy. Will conflict in multi-worktree setups."

---

## Phase 4: Makefile Worktree-Aware

**Goal:** Update all Makefile targets to use `COMPOSE_PROJECT_NAME` and dynamic ports instead of hardcoded values.

**Why now:** With dynamic infra ports in place, the Makefile needs to match. This phase doesn't add new functionality — it updates existing targets.

### Changes

1. **Add at top of Makefile:**
   ```makefile
   -include .worktree
   COMPOSE_PROJECT_NAME ?= wallpaperdb
   INGRESS_PORT ?= 8000
   POSTGRES_HOST_PORT ?= 8001
   MINIO_API_HOST_PORT ?= 8002
   NATS_HOST_PORT ?= 8003
   REDIS_HOST_PORT ?= 8004
   OPENSEARCH_HOST_PORT ?= 8005
   OTEL_HTTP_HOST_PORT ?= 8006
   OTEL_GRPC_HOST_PORT ?= 8007
   export COMPOSE_PROJECT_NAME
   export INGRESS_PORT
   ```

2. **Replace `infra-start` / `infra-stop` / `infra-reset` / `infra-logs`** — Call `docker compose` directly with `-p $(COMPOSE_PROJECT_NAME) -f infra/docker-compose.yml` instead of delegating through Turbo→shell scripts. See v2 for exact implementations.

3. **Update `redis-cli` / `redis-flush` / `redis-info`** — Replace `docker exec -it wallpaperdb-redis` with `docker compose -p $(COMPOSE_PROJECT_NAME) -f infra/docker-compose.yml exec redis`.

4. **Update `nats-setup-streams` / `nats-stream-list` / `nats-stream-info`** — Replace hardcoded `localhost:4222` with `docker compose exec` patterns.

5. **Update `ingestor-docker-build` / `ingestor-docker-run` / `ingestor-docker-stop` / `ingestor-docker-logs`** — Replace hardcoded `wallpaperdb-ingestor` with `$(COMPOSE_PROJECT_NAME)-ingestor`.

6. **Add new targets:** `psql`, `psql-ingestor`, `psql-media`, `db-studio-ingestor`, `db-studio-media`, `worktree-remove` (placeholder — calls the teardown script from Phase 12).

7. **Update `dev` target** — Add infra check (placeholder script for now, just check if postgres container is running via `docker compose ps`).

### Verification

```bash
make infra-start             # Works, uses project name
make redis-cli               # Connects to redis (type PING, expect PONG, then exit)
make redis-info              # Shows redis info
make nats-stream-list        # Lists NATS streams
make psql                    # Opens psql shell (type \q to exit)
make infra-stop              # Stops with project name
make infra-start && make infra-logs  # Logs stream correctly (Ctrl+C to stop)
make infra-stop
```

### Backwards Compatibility

Fully backwards compatible. Default values match current behavior. Fresh clones without `.worktree` use the defaults.

---

## Phase 5: NATS Stream Automation

**Goal:** Automate NATS stream creation as a one-shot Docker service, mirroring the existing `minio-init` pattern.

**Why now:** Small, self-contained change. Currently NATS streams require `make nats-setup-streams` manually. This automates it.

### Changes

1. **`infra/docker-compose.yml`** — Add `nats-setup` service:
   ```yaml
   nats-setup:
     image: natsio/nats-box:latest
     depends_on:
       nats:
         condition: service_healthy
     environment:
       - NATS_SERVER=nats://nats:4222
     volumes:
       - ./nats/init:/scripts:ro
     entrypoint: ["/scripts/setup-streams.sh"]
     restart: on-failure
   ```

   Note: `infra/nats/init/setup-streams.sh` supports `$NATS_SERVER` env var. The standalone scripts (`create-wallpaper-stream.sh` and `create-example-stream.sh`) have been removed since `setup-streams.sh` is the only script used by the Docker container.

### Verification

```bash
make infra-start
# Watch for nats-setup container to run and exit successfully:
docker compose -p wallpaperdb -f infra/docker-compose.yml ps -a | grep nats-setup
# Should show "Exited (0)"

make nats-stream-list
# Should show WALLPAPER stream exists
make infra-stop
```

### Backwards Compatibility

Fully backwards compatible. Adds automation for something that was previously manual.

---

## Phase 6: App Dockerfiles + Entrypoint

**Goal:** Create development Dockerfiles for all 5 apps and the shared entrypoint script. These are not used yet — Phase 7 wires them into Docker Compose.

**Why now:** Dockerfiles can be built and tested in isolation. If there's a build issue, it's caught here before adding the compose complexity.

### Changes

1. **Create `apps/ingestor/Dockerfile.dev`** — See v2 for the template. Key points:
   - `FROM node:22-alpine`
   - Install pnpm via corepack
   - `COPY . .` from repo root (build context is repo root)
   - `RUN pnpm install --frozen-lockfile`
   - `WORKDIR /app/apps/ingestor`
   - `ENTRYPOINT ["/entrypoint.sh"]`
   - `CMD ["pnpm", "exec", "tsx", "watch", "src/index.ts"]`

2. **Create `apps/media/Dockerfile.dev`** — Same pattern, `WORKDIR /app/apps/media`.

3. **Create `apps/gateway/Dockerfile.dev`** — Same pattern, `WORKDIR /app/apps/gateway`.

4. **Create `apps/variant-generator/Dockerfile.dev`** — Same pattern, `WORKDIR /app/apps/variant-generator`.

5. **Create `apps/web/Dockerfile.dev`** — Same pattern but:
   - `WORKDIR /app/apps/web`
   - `CMD ["pnpm", "exec", "vite", "--port", "3005", "--host"]`

6. **Create `scripts/entrypoint.sh`** — Shared entrypoint:
   - Hash `pnpm-lock.yaml`, compare against stored hash. Re-run `pnpm install --frozen-lockfile` if changed.
   - For ingestor/media: run `pnpm run db:migrate` (idempotent).
   - `exec "$@"` to hand off to CMD.

### Verification

```bash
# Build each Dockerfile (context is repo root):
docker build -f apps/ingestor/Dockerfile.dev -t test-ingestor-dev .
docker build -f apps/media/Dockerfile.dev -t test-media-dev .
docker build -f apps/gateway/Dockerfile.dev -t test-gateway-dev .
docker build -f apps/variant-generator/Dockerfile.dev -t test-vg-dev .
docker build -f apps/web/Dockerfile.dev -t test-web-dev .

# All should build successfully. Clean up:
docker rmi test-ingestor-dev test-media-dev test-gateway-dev test-vg-dev test-web-dev
```

### Backwards Compatibility

Fully backwards compatible. These files are created but not referenced by anything yet.

---

## Phase 7: App Compose File

**Goal:** Create `infra/docker-compose.apps.yml` with all 5 app services and `docker compose watch` configuration.

**Why now:** With Dockerfiles proven to build, we can now wire them into a compose file. This phase does NOT include Caddy (Phase 8) or change dev scripts (Phase 11).

### Changes

1. **Create `infra/docker-compose.apps.yml`** — See v2 for the full structure. Key points:
   - 5 app services (ingestor, media, gateway, variant-generator, web)
   - Each uses its `Dockerfile.dev` with build context `..` (repo root)
   - Each has `env_file` pointing to its `.env`
   - Each has `develop.watch` config syncing: `src/`, `packages/`, `package.json`, `pnpm-lock.yaml`
   - Network: `external: true`, name = `${COMPOSE_PROJECT_NAME}_network` (created by infra compose)
   - No Caddy yet — that's Phase 8

### Verification

```bash
# Ensure infra is running (creates the network):
make infra-start

# Build all app services:
docker compose -p wallpaperdb -f infra/docker-compose.apps.yml build

# Verify services can start (they'll need .env files — create minimal ones or use existing):
# This is a build-only verification. Full runtime test is Phase 11.

make infra-stop
```

### Backwards Compatibility

Fully backwards compatible. The file exists but nothing uses it yet.

---

## Phase 8: Caddy Ingress

**Goal:** Add the Caddy reverse proxy that provides single-port access to all services and admin UIs.

**Why now:** The app compose file exists, infrastructure is parameterized. Caddy ties them together. This restores access to admin UIs that lost their host ports in Phase 3.

### Changes

1. **Create `infra/caddy/Caddyfile`** — See v2 for full routing table. Routes all services and admin UIs through path prefixes on `:{$INGRESS_PORT}`.

2. **Update `infra/docker-compose.apps.yml`** — Add caddy service:
   ```yaml
   caddy:
     image: caddy:2-alpine
     ports:
       - "${INGRESS_PORT:-8000}:${INGRESS_PORT:-8000}"
     volumes:
       - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
     environment:
       - INGRESS_PORT=${INGRESS_PORT:-8000}
     depends_on: [ingestor, media, gateway, variant-generator, web]
   ```

3. **Update `infra/docker-compose.yml`** — Add sub-path environment variables for admin UIs:
   - `lgtm`: `GF_SERVER_ROOT_URL=http://localhost/grafana`, `GF_SERVER_SERVE_FROM_SUB_PATH=true`
   - `pgadmin`: `SCRIPT_NAME=/pgadmin`
   - `opensearch-dashboards`: `SERVER_BASEPATH=/opensearch-dashboards`, `SERVER_REWRITEBASEPATH=true`

### Verification

```bash
make infra-start

# Start apps with placeholder .env files (or generate them — Phase 10 automates this):
# For now, create minimal .env files manually for each app if they don't exist.

# Start caddy + apps:
docker compose -p wallpaperdb -f infra/docker-compose.apps.yml up -d

# Test Caddy is reachable:
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/
# Should get a response (404 is OK — means Caddy is running)

# Test admin UI sub-paths (if infra is up):
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/grafana/
# Should get 200 or 302 (Grafana login redirect)

docker compose -p wallpaperdb -f infra/docker-compose.apps.yml down
make infra-stop
```

**Note:** Full routing verification (app services responding at their paths) requires Phase 10 (app .env files) and Phase 11 (dev script switchover). This phase verifies Caddy starts and admin UI sub-paths work.

### Backwards Compatibility

Backwards compatible. Caddy is additive. Admin UIs gain sub-path support but their configuration doesn't break non-Caddy access if the removed ports from Phase 3 are re-added.

---

## Phase 9: Web Sub-path Support

**Goal:** Make the web frontend work correctly behind Caddy's `/web` prefix.

**Why now:** This is independent of Docker/compose changes. It can actually be done in parallel with Phases 6-8. Placed here because it's best verified with Caddy running.

### Changes

1. **`apps/web/vite.config.ts`** — Add `base: process.env.VITE_BASE_PATH ?? '/'` as a top-level option. Add `host: true` to server config (needed inside Docker).

2. **`apps/web/src/App.tsx`** — Add `basepath: import.meta.env.VITE_BASE_PATH || '/'` to `createRouter()`.

3. **`apps/web/src/lib/services/wallpaper-share.ts`** — Prepend `import.meta.env.VITE_BASE_PATH || ''` to the constructed URL.

4. **`apps/web/src/routes/__root.tsx`** — Verify the pathname check. TanStack Router with `basepath` should strip the prefix from `location.pathname`, so the existing check should work. **If it doesn't**, update to:
   ```typescript
   const basePath = import.meta.env.VITE_BASE_PATH || '';
   const isWallpaperDetailsPage = routerState.location.pathname.startsWith(`${basePath}/wallpapers/`);
   ```
   Document which behavior was observed.

### Verification

```bash
# Verify no type errors:
make check-types

# Test without VITE_BASE_PATH (should behave identically to current):
pnpm --filter @wallpaperdb/web dev
# Open http://localhost:3005 — app should work normally
# Ctrl+C

# Test with VITE_BASE_PATH=/web:
VITE_BASE_PATH=/web pnpm --filter @wallpaperdb/web dev
# Open http://localhost:3005/web — app should load
# Check: all asset paths include /web prefix (view source)
# Check: navigation links include /web prefix
# Check: share URL includes /web prefix
# Ctrl+C
```

### Backwards Compatibility

Fully backwards compatible. Without `VITE_BASE_PATH`, everything defaults to `/` (current behavior).

---

## Phase 10: App .env Generation

**Goal:** Extend `setup-worktree.mjs` to generate `.env` files for all apps with Docker-internal service names and worktree-specific values.

**Why now:** The Dockerfiles (Phase 6) and compose file (Phase 7) reference `env_file` for each app. This phase produces those files.

### Changes

1. **Extend `scripts/setup-worktree.mjs`** — Add `.env` generation for each app. The script should:
   - Read each app's `.env.example` as a template
   - Override values with Docker-internal hostnames:
     - `DATABASE_URL=postgresql://wallpaperdb:wallpaperdb@postgres:5432/wallpaperdb_<service>`
     - `S3_ENDPOINT=http://minio:9000`
     - `NATS_URL=nats://nats:4222`
     - `REDIS_HOST=redis`
     - `OTEL_EXPORTER_OTLP_ENDPOINT=http://lgtm:4318`
   - **Gateway special case:** `MEDIA_SERVICE_URL=http://localhost:<INGRESS_PORT>/media` (browser-reachable, NOT Docker-internal). Auto-generate `CURSOR_SECRET` via `crypto.randomBytes(32).toString('hex')`.
   - **Web:** `VITE_BASE_PATH=/web`, `VITE_GATEWAY_URL=http://localhost:<INGRESS_PORT>/gateway/graphql`, `VITE_INGESTOR_URL=http://localhost:<INGRESS_PORT>/ingestor`
   - **Variant Generator:** `PORT=3006`
   - Be idempotent — don't regenerate if values haven't changed (preserve user edits where possible, or document that `.env` files are fully generated and should not be hand-edited)

2. **Verify each app's `.env.example` exists and has the expected keys.** If any are missing, create them.

### Verification

```bash
# Remove existing .env files to test generation:
rm -f apps/ingestor/.env apps/media/.env apps/gateway/.env apps/variant-generator/.env apps/web/.env

pnpm install
# Should regenerate all .env files

# Check ingestor:
grep "postgres:5432" apps/ingestor/.env       # Docker-internal hostname
grep "minio:9000" apps/ingestor/.env          # Docker-internal hostname
grep "nats:4222" apps/ingestor/.env           # Docker-internal hostname

# Check gateway:
grep "localhost:8000/media" apps/gateway/.env  # Browser-reachable MEDIA_SERVICE_URL
grep "CURSOR_SECRET" apps/gateway/.env         # Auto-generated

# Check web:
grep "VITE_BASE_PATH=/web" apps/web/.env
grep "localhost:8000/gateway" apps/web/.env
grep "localhost:8000/ingestor" apps/web/.env

# Check variant-generator:
grep "PORT=3006" apps/variant-generator/.env
```

### Backwards Compatibility

**Breaking for host-based development.** After this phase, `.env` files point to Docker service names (`postgres`, `minio`, etc.) instead of `localhost`. Developers who run services on the host (without Docker) will need to manually edit `.env` files or revert them.

**Mitigation:** The old `.env.example` files still work for host-based development. A developer can `cp .env.example .env` in any app to restore host-based values. Consider adding a `make env-host` target that copies `.env.example` files for host-based development.

---

## Phase 11: Dev Script Switchover

**Goal:** Change the `make dev` workflow from running apps on the host to running them in Docker containers via `docker compose watch`.

**Why now:** All prerequisites are in place — Dockerfiles, compose file, Caddy, .env files. This is the "flip the switch" phase.

### Changes

1. **Each app's `package.json` `dev` script** — Change from `tsx watch src/index.ts` (or `vite --port 3005`) to:
   ```
   docker compose -p $COMPOSE_PROJECT_NAME -f ../../infra/docker-compose.apps.yml watch <service-name>
   ```
   The `../../` relative path works because the dev script runs from the app's directory.

2. **`turbo.json`** — Add `COMPOSE_PROJECT_NAME` to `globalPassThroughEnv`:
   ```json
   "globalPassThroughEnv": ["GITHUB_ACTIONS", "COMPOSE_PROJECT_NAME"]
   ```

3. **Create `scripts/check-infra.sh`** — Check if infra containers are running:
   ```bash
   #!/bin/bash
   set -e
   source "$(dirname "$0")/../.worktree" 2>/dev/null || { echo "No .worktree file. Run pnpm install first."; exit 1; }
   docker compose -p "$COMPOSE_PROJECT_NAME" -f infra/docker-compose.yml \
     ps --status running --format '{{.Service}}' | grep -q '^postgres$'
   ```

4. **Update `make dev`** — Add infra check before running turbo:
   ```makefile
   dev:
   	@scripts/check-infra.sh || \
   	  (echo "Infra is not running. Start it first with: make infra-start" && exit 1)
   	@turbo dev
   ```

### Verification

```bash
make infra-start
make dev
# Turbo TUI should appear with all 5 services
# Each service should be running via docker compose watch

# Test hot reload:
# Edit a file in apps/ingestor/src/ → container should pick up the change

# Test ingress:
curl http://localhost:8000/ingestor/health    # Should return 200
curl http://localhost:8000/media/health       # Should return 200
curl http://localhost:8000/gateway/health     # Should return 200

# Test web:
# Open http://localhost:8000/web in browser — should load the web app

# Ctrl+C to stop turbo
make infra-stop
```

### Backwards Compatibility

**Breaking.** This changes the development workflow. Developers must:
- Have Docker running
- Run `make infra-start` before `make dev`
- Access services via `http://localhost:<INGRESS_PORT>/<service>` instead of direct ports

The CI pipeline may need updates if it runs `turbo dev` or relies on host-based service execution. Test commands (`make test`, etc.) should still work because they use Vitest, not the dev scripts.

---

## Phase 12: Teardown + Cleanup

**Goal:** Create the worktree cleanup script and finalize stale slot detection.

**Why now:** Everything is working. This phase adds the cleanup path for removing worktrees safely.

### Changes

1. **Create `scripts/teardown-worktree.mjs`** — Called by `make worktree-remove`:
   - Read `COMPOSE_PROJECT_NAME` and `WORKTREE_SLOT` from `.worktree`
   - If `WORKTREE_SLOT != 0`: run `docker compose -p <name> down --volumes --remove-orphans` for both infra and apps compose files
   - If `WORKTREE_SLOT == 0`: run without `--volumes` (preserve main data)
   - Remove slot file at `.git/worktrees/<name>/worktree-slot`
   - Print confirmation

2. **Wire up `make worktree-remove`** — This target was added as a placeholder in Phase 4. Now it calls the real script.

3. **Enhance stale slot detection in `setup-worktree.mjs`** — On every `pnpm install`, scan all `worktree-slot` files in `.git/worktrees/`. For any whose worktree path no longer exists on disk, print a warning with the cleanup command.

### Verification

```bash
# In a test worktree (not main):
cat .worktree
# Should show WORKTREE_SLOT != 0

make infra-start
# Containers running for this worktree

make worktree-remove
# Should stop containers, remove volumes, release slot

docker ps -a --filter "name=wallpaperdb-feat" --format '{{.Names}}'
# Should show no containers

# Verify slot file removed:
# Check .git/worktrees/<name>/worktree-slot no longer exists

# In main worktree:
make worktree-remove
# Should stop containers but NOT remove volumes
# Main data preserved
```

### Backwards Compatibility

Fully backwards compatible. Adds new functionality only.

---

## Dependency Graph

```
Phase 1 (bug fixes) ─────────────────────────────────────────────────┐
Phase 2 (slot assignment) ──┬── Phase 3 (dynamic ports) ──┬── Phase 4 (Makefile) ─┐
                            │                              │                       │
                            │   Phase 5 (NATS automation) ─┘                       │
                            │                                                      │
                            ├── Phase 10 (app .env gen) ───────── Phase 11 ────────┤
                            │                                     (dev switch)     │
Phase 9 (web sub-path) ────────────────────────────────────────────┘               │
                                                                                   │
Phase 6 (Dockerfiles) ── Phase 7 (app compose) ── Phase 8 (Caddy) ── Phase 11 ────┤
                                                                                   │
                                                                    Phase 12 ──────┘
                                                                    (teardown)
```

**Parallelizable:** Phases 1, 9 can be done at any time. Phases 6-8 can be done in parallel with Phases 3-5 (but 6→7→8 must be sequential).

---

## End-to-End Verification (after all phases)

After all 12 phases, verify the complete workflow:

```bash
# 1. Fresh worktree setup
git worktree add ../test-worktree feat/test-branch
cd ../test-worktree
pnpm install
# → .worktree created with slot 1, ingress 8010

# 2. Start infra
make infra-start
# → all containers running with wallpaperdb-feat-test-branch prefix
# → NATS streams created automatically

# 3. Start dev
make dev
# → Turbo TUI with all services via docker compose watch
# → Access at http://localhost:8010

# 4. Verify routing
curl http://localhost:8010/ingestor/health
curl http://localhost:8010/media/health
curl http://localhost:8010/gateway/health
# Open http://localhost:8010/web in browser
# Open http://localhost:8010/grafana in browser

# 5. Meanwhile, main worktree still works
cd /path/to/main
make dev
# → Still on port 8000, no conflicts

# 6. Clean up test worktree
cd ../test-worktree
make worktree-remove
cd /path/to/main
git worktree remove ../test-worktree
```

---

## Known Risks / Notes

Carried forward from v2:

1. **MinIO Console sub-path** — May need `MINIO_BROWSER_REDIRECT_URL`. Test in Phase 8.
2. **OpenSearch Dashboards sub-path** — `SERVER_BASEPATH` + `SERVER_REWRITEBASEPATH=true` may interact with `DISABLE_SECURITY_DASHBOARDS_PLUGIN=true`. Test in Phase 8.
3. **Branch slug collision** — Extremely unlikely. Setup script detects and warns.
4. **TanStack Router `location.pathname` with `basepath`** — Test in Phase 9. Fallback documented.
5. **Vite HMR through Caddy** — WebSocket upgrades should be transparent. If not, add `server.hmr.clientPort` and `server.hmr.host` to vite.config.ts. Test in Phase 11.
6. **Shell scripts become secondary** — `infra/scripts/*.sh` are superseded by Makefile targets. Keep them for manual use but they're no longer the primary path.
7. **CI pipeline** — Test commands use Vitest directly and should not be affected. The `dev` script change (Phase 11) only affects `make dev`, not `make test`. Verify CI still passes after Phase 11.
