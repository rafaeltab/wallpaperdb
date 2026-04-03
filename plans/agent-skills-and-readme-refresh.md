# Agent Skills and README Refresh Plan

**Status:** Phase 23 complete
**Created:** 2026-04-03

---

## Executive Summary

Replace the monolithic `AGENTS.md` file with a set of focused agent skills and fresh per-workspace READMEs. The goal is to give agents accurate, discoverable, and maintainable context — without a single file that goes out of date and grows unbounded.

**Key principles:**
- Skills encode *how to work* (processes, conventions) — not *what exists* (services, files, config values)
- READMEs encode *what a workspace is and why it exists* — not how to run it or what files it contains
- Progressive disclosure: agents navigate from skills → repo structure → READMEs → source code

---

## Phases

### Phase 1 — Skill: `development-principles` ✅ COMPLETE

Create `.agents/skills/development-principles/SKILL.md`.

Contents:
- TDD: write tests before implementation, every change needs a test
- Incremental changes: small focused changes, never big-bang refactoring
- Document as you go: update `apps/docs/`, create ADRs, update `plans/`
- Migration strategy: create new structure alongside old, migrate piece by piece, remove old only when fully migrated
- Command execution policy: always use Make (`make help`), never raw pnpm/turbo commands

---

### Phase 2 — Skill: `project-overview` ✅ COMPLETE

Create `.agents/skills/project-overview/SKILL.md`.

Contents:
- What WallpaperDB is (wallpaper management system, event-driven microservices)
- Tech stack: Fastify + TSyringe, Turborepo + pnpm workspaces, PostgreSQL + Drizzle ORM, MinIO, NATS JetStream, Vitest + Testcontainers, OpenTelemetry + Grafana, Biome
- Monorepo layout: `apps/` = services + frontends, `packages/` = shared libraries, `infra/` = Docker Compose infrastructure, `plans/` = architectural decisions, `apps/docs/` = documentation site
- How to discover what a service/package does: read its `README.md`
- Strategic direction: Fastify over NestJS (see ADR-001)
- Documentation site: `apps/docs/content/docs/`, view with `make docs-dev`

---

### Phase 3 — Skill: `testing` ✅ COMPLETE

Create `.agents/skills/testing/SKILL.md`.

Contents:
- Three test tiers and when to use each:
  - Unit: fast, no containers, pure logic (`packages/`)
  - Integration: Testcontainers, real infrastructure, full workflows (`apps/`)
  - E2E: Docker artifact, slowest, most realistic (`apps/*-e2e`)
- Infrastructure must be running before integration/E2E tests (`make infra-start`)
- Key tip: use `127.0.0.1` instead of `localhost` in Testcontainers (avoids ~5s DNS delay)
- Coverage commands and where reports land
- Debugging checklist: check infra logs, Drizzle Studio, MinIO console, NATS monitoring
- Pointer to TesterBuilder pattern docs

---

### Phase 4 — Skill: `create-service` ✅ COMPLETE

Create `.agents/skills/create-service/SKILL.md`.

Contents:
- Creating a new microservice in `apps/`: copy structure from `apps/ingestor`, use shared packages (`@wallpaperdb/core`, `@wallpaperdb/events`), register OpenAPI, add Make targets, add to CI/CD workflows, write README (use `write-readme` skill), document in `apps/docs/content/docs/services/`
- Creating a new shared package in `packages/`: directory setup, `@wallpaperdb/` scoped `package.json`, Vitest, Make targets if needed, document in `apps/docs/content/docs/architecture/shared-packages.mdx`, write README
- Target time: ~1 week per service
- Pointer to `plans/multi-service-architecture.md`

---

### Phase 5 — Skill: `database-schema` ✅ COMPLETE

Create `.agents/skills/database-schema/SKILL.md`.

Contents:
- Drizzle ORM workflow: edit `src/db/schema.ts` → generate migration → review generated SQL in `drizzle/` → apply migration
- Commands (scoped per service): `db:generate`, `db:push` (dev only), `db:migrate`, `db:studio`
- Note: these are pnpm scripts, not yet in Makefile — run via `pnpm --filter @wallpaperdb/<service> db:<command>`

---

### Phase 6 — Skill: `write-readme` ✅ COMPLETE

Create `.agents/skills/write-readme/SKILL.md`.

Contents:
- When to use: adding a new workspace, or refreshing an existing README
- Process: (1) delete existing README if present, (2) read the entire workspace source, (3) write a new executive summary README
- README format rules:
  - What this workspace is and why it exists (1–2 sentences)
  - Key capabilities — what it does, not how it does it
  - Technology choices specific to this component (not the whole stack)
  - No file trees, no make commands, no config values, no environment variables, no localhost URLs, no specific file references
  - No information that changes as the codebase evolves
- Validation checklist: could this README become stale without code changes? If yes, remove that content.

---

### Phase 7 — README: `apps/ingestor` ✅ COMPLETE

Delete existing README. Read entire service source. Write new executive summary README.

---

### Phase 8 — README: `apps/ingestor-e2e` ✅ COMPLETE

Delete existing README. Read entire workspace source. Write new executive summary README.

---

### Phase 9 — README: `apps/gateway` ✅ COMPLETE

Delete existing README. Read entire service source. Write new executive summary README.

---

### Phase 10 — README: `apps/media` ✅ COMPLETE

Delete existing README. Read entire service source. Write new executive summary README.

---

### Phase 11 — README: `apps/variant-generator` ✅ COMPLETE

No existing README. Read entire service source. Write new executive summary README.

---

### Phase 12 — README: `apps/web` ✅ COMPLETE

Delete existing README. Read entire service source. Write new executive summary README.

---

### Phase 13 — README: `apps/docs` ✅ COMPLETE

Delete existing README. Read workspace source. Write new executive summary README.

---

### Phase 14 — README: `packages/core` ✅ COMPLETE

Delete existing README. Read entire package source. Write new executive summary README.

---

### Phase 15 — README: `packages/events` ✅ COMPLETE

Delete existing README. Read entire package source. Write new executive summary README.

---

### Phase 16 — README: `packages/test-utils` ✅ COMPLETE

Delete existing README. Read entire package source. Write new executive summary README.

---

### Phase 17 — README: `packages/testcontainers` ✅ COMPLETE

Delete existing README. Read entire package source. Write new executive summary README.

---

### Phase 18 — README: `packages/url-ipv4-resolver` ✅ COMPLETE

Delete existing README. Read entire package source. Write new executive summary README.

---

### Phase 19 — README: `packages/react-muuri` ✅ COMPLETE

Delete existing README. Read entire package source. Write new executive summary README.

---

### Phase 20 — README: `packages/test-logger` ✅ COMPLETE

No existing README. Read entire package source. Write new executive summary README.

---

### Phase 21 — README: `packages/vitest-config` ✅ COMPLETE

No existing README. Read entire package source. Write new executive summary README.

---

### Phase 22 — README: repo root ✅ COMPLETE

No existing README. Write a root-level `README.md` that gives humans and agents an entry point: what WallpaperDB is, how the repo is structured, and where to start.

---

### Phase 23 — Delete `AGENTS.md` ✅ COMPLETE

Delete `AGENTS.md` from the repo root. All useful long-term information will have been migrated to skills (phases 1–6) and READMEs (phases 7–22).
