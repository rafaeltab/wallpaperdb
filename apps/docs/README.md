# @wallpaperdb/docs

The primary documentation site for WallpaperDB, serving as a single authoritative reference for developers and AI agents working across the monorepo.

## Key Capabilities

- Hosts MDX-authored documentation covering development guidelines, architectural decisions, testing strategy, service descriptions, shared package references, and operational guides
- Auto-generates REST API reference pages from the OpenAPI specifications exported by each service, keeping the API docs in sync with the live service contracts
- Exposes a full-text endpoint formatted for LLM consumption, enabling AI agents to retrieve the entire documentation corpus in a single request

## Technology Choices

- **Fumadocs** — documentation framework that provides MDX content pipeline, navigation, full-text search, and a structured Next.js UI; chosen for its deep OpenAPI integration and MDX-first authoring model
- **fumadocs-openapi** — generates typed, navigable API reference pages directly from OpenAPI specs without manual authoring
- **Next.js (App Router)** — hosts the documentation as a statically exportable web application
