---
name: project-overview
description: High-level overview of WallpaperDB: what it is, the tech stack, monorepo layout, and how to navigate the codebase. Use when starting work in an unfamiliar part of the repo, orienting a new task, or answering questions about the overall system.
---

# Project Overview

## What WallpaperDB Is

WallpaperDB is a wallpaper management system built as an event-driven microservices platform. Users upload wallpapers; the system validates, stores, and enriches them, making them searchable and retrievable at any resolution.

## Tech Stack

| Concern | Technology |
|---|---|
| HTTP servers | Fastify + TSyringe (dependency injection) |
| Monorepo tooling | Turborepo + pnpm workspaces |
| Database | PostgreSQL with Drizzle ORM |
| Object storage | MinIO (S3-compatible) |
| Messaging | NATS JetStream |
| Testing | Vitest + Testcontainers |
| Observability | OpenTelemetry + Grafana LGTM stack |
| Linting / formatting | Biome |

## Monorepo Layout

```
apps/       — deployable services and frontends
packages/   — shared libraries consumed by apps
infra/      — Docker Compose infrastructure for local development
plans/      — architectural decisions and long-running plans
apps/docs/  — documentation site (Fumadocs)
```

To understand what any specific service or package does, **read its `README.md`**.

## Documentation Site

All architecture docs, guides, and ADRs live in `apps/docs/content/docs/`.
