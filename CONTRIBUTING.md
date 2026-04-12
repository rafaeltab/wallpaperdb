# Contributing to WallpaperDB

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 22 | Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) |
| pnpm | 9 | `npm install -g pnpm` |
| Docker Desktop | latest | Compose v2.22+ required for hot reload |
| git | 2.5+ | For worktree support |

Verify your setup:
```bash
node --version       # v22.x.x
pnpm --version       # 9.x.x
docker compose version  # v2.22.x or higher
```

---

## First-time setup

```bash
git clone https://github.com/your-org/wallpaperdb.git
cd wallpaperdb
pnpm install
```

`pnpm install` runs a postinstall script that:
- Assigns a **worktree slot** (slot 0 for the main checkout)
- Writes a `.worktree` file with port assignments and the Docker project name
- Generates `infra/.env` and per-app `.env` files

You should see output like:
```
[setup-worktree] Worktree slot 0 assigned.
  Project name : wallpaperdb
  Ingress      : http://localhost:8000
  Postgres     : localhost:8001
  ...
```

---

## Starting the development environment

### 1. Start infrastructure

```bash
make infra-start
```

This starts PostgreSQL, MinIO, NATS, Redis, OpenSearch, and Grafana in Docker. First run takes about 2 minutes as images are pulled.

### 2. Start all services

```bash
make dev
```

This starts all 5 application services (ingestor, media, variant-generator, gateway, web) plus the Caddy ingress proxy via Docker Compose. Source changes are synced into containers automatically — no rebuild needed.

---

## Accessing the application

Everything runs behind a single ingress at **http://localhost:8000**.

| URL | Service |
|---|---|
| http://localhost:8000/web | Web frontend |
| http://localhost:8000/ingestor | Ingestor API |
| http://localhost:8000/media | Media API |
| http://localhost:8000/gateway | GraphQL gateway |
| http://localhost:8000/variant-generator | Variant generator API |
| http://localhost:8000/grafana | Grafana (observability) |
| http://localhost:8000/minio | MinIO console |
| http://localhost:8000/pgadmin | pgAdmin |
| http://localhost:8000/opensearch-dashboards | OpenSearch Dashboards |
| http://localhost:8000/nats | NATS monitoring |

Individual service health checks:
```bash
curl http://localhost:8000/ingestor/health
curl http://localhost:8000/media/health
curl http://localhost:8000/gateway/health
```

---

## Running tests

Tests do not require `make dev` to be running. They spin up their own containers via Testcontainers.

```bash
make test-unit         # Fast, no Docker needed (~5s)
make test-integration  # Integration tests with real infra containers (~30s)
make test-e2e          # Full E2E tests, sequential (~2min)
make test              # All of the above
make ci                # Full CI pipeline — use this before opening a PR
```

---

## Stopping

**Stop the application services** (Ctrl+C in the `make dev` terminal, or):
```bash
docker compose -p wallpaperdb -f infra/docker-compose.apps.yml down
```

**Stop infrastructure** (preserves volumes/data):
```bash
make infra-stop
```

**Reset infrastructure** (deletes all data):
```bash
make infra-reset
```

---

## Working with multiple worktrees

WallpaperDB supports running multiple git worktrees simultaneously with full isolation — each worktree gets its own Docker containers, volumes, and port range.

### Add a new worktree

```bash
git worktree add ../wallpaperdb-my-feature feat/my-feature
cd ../wallpaperdb-my-feature
pnpm install
```

This assigns the next available slot (e.g., slot 1) and outputs:
```
[setup-worktree] Worktree slot 1 assigned.
  Project name : wallpaperdb-feat-my-feature
  Ingress      : http://localhost:8010
  Postgres     : localhost:8011
  ...
```

All services for this worktree are then available at **http://localhost:8010** — no conflict with the main worktree on port 8000.

### Work in the worktree

```bash
make infra-start   # Starts infra for this worktree only
make dev           # Starts app services for this worktree only
```

### Tear down a worktree

Before removing a worktree from git, stop its containers and release its slot:

```bash
make worktree-remove
```

This stops all containers, removes volumes (non-main worktrees only), and releases the slot so it can be reused.

Then remove the worktree from git:
```bash
cd /path/to/main-checkout
git worktree remove ../wallpaperdb-my-feature
```

### Stale slot detection

If a worktree directory was deleted without running `make worktree-remove`, the next `pnpm install` will detect the orphaned slot and print instructions:
```
⚠️  Stale worktree slot detected:
   Slot:     1
   Worktree: /path/to/worktree (no longer exists)

   To release this slot and clean up any Docker containers,
   run the following from this repository's root directory:

     node scripts/teardown-worktree.mjs --slot-file "<path>"
```

---

## Useful commands

```bash
make help              # Full list of available commands
make psql-ingestor     # Open a psql shell on the ingestor database
make psql-media        # Open a psql shell on the media database
make redis-cli         # Open a Redis CLI session
make nats-stream-list  # List NATS JetStream streams
make check-types       # Type-check all packages
make lint              # Lint all packages
make format            # Format all packages
make docs-dev          # Start the documentation site (http://localhost:3002)
```
