---
name: implement-frontend
description: Frontend feature implementation guide for apps/web. Use when adding a new page, building a UI component, or implementing any React feature.
---

# Implement Frontend

All frontend code lives in `apps/web`. The stack is React 19 + Vite + TypeScript + TanStack Router + TanStack Query + shadcn/ui + Tailwind CSS v4.

## Guides

- [Routing](ROUTING.md) — TanStack Router: adding pages, layouts, dynamic routes
- [Components](COMPONENTS.md) — shadcn/ui via MCP, Tailwind v4 styling, component patterns
- [Data Fetching](DATA-FETCHING.md) — TanStack Query, GraphQL, and REST
- [Testing](TESTING.md) — Vitest, Testing Library, global mocks

## Key Commands

```bash
make web-dev          # Start dev server (http://localhost:3005)
make web-test         # Run tests (single pass)
make web-test-watch   # Run tests in watch mode
make web-check        # TypeScript type check
make web-lint         # Lint
make web-build        # Production build
```

## Directory Layout

```
apps/web/src/
  routes/          # File-based route files (TanStack Router)
  components/
    ui/            # 24 installed shadcn/ui components
    <feature>/     # Feature-specific components
  hooks/           # Custom React hooks
  contexts/        # React Context providers
  lib/
    graphql/       # GraphQL client + queries + types
    api/           # REST API functions
    utils.ts       # cn() helper (clsx + tailwind-merge)
apps/web/test/     # All test files (mirror of src/)
```
