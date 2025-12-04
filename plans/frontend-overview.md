# Frontend Scaffold - Overview

**Goal:** Create an MVP frontend SPA using Vite + React + TanStack Router + TanStack Query + Tailwind CSS to browse wallpapers via Gateway GraphQL API and upload wallpapers to Ingestor service.

## Technology Stack

- **Framework:** Vite 6 + React 19 + TypeScript
- **Routing:** TanStack Router (type-safe)
- **Data Fetching:** TanStack Query + graphql-request
- **Styling:** Tailwind CSS 4
- **Code Quality:** Biome
- **Port:** 3003

## Implementation Phases

Execute these phases in order:

### Phase 1: Project Setup
**File:** `frontend-phase-1-project-setup.md`
- Create directory structure
- Initialize package.json
- Add configuration files (vite, tsconfig, tailwind, biome)
- Add Makefile targets
- Install dependencies

### Phase 2: Core Infrastructure
**File:** `frontend-phase-2-core-infrastructure.md`
- GraphQL client setup (Gateway integration)
- TanStack Query configuration
- Ingestor upload client
- Type definitions

### Phase 3: Routes & Components
**File:** `frontend-phase-3-routes-components.md`
- Root layout with navigation
- Home page (browse wallpapers)
- Upload page
- Entry points (index.html, main.tsx)

### Phase 4: Environment Configuration
**File:** `frontend-phase-4-environment-config.md`
- .env.example and .gitignore
- Environment variable setup

## Success Criteria

1. ✅ `make web-dev` starts Vite dev server on port 3003
2. ✅ Home page displays wallpapers from Gateway GraphQL API
3. ✅ Upload page sends files to Ingestor REST API
4. ✅ TanStack Query/Router devtools accessible
5. ✅ Tailwind CSS styling applied
6. ✅ Biome formatting/linting works
7. ✅ TypeScript strict mode, no errors

## Backend Integration

**Gateway (GraphQL):** `http://localhost:3000/graphql`
- Query: `searchWallpapers` with cursor-based pagination
- Returns: Wallpapers with variants (url is computed field)

**Ingestor (REST):** `http://localhost:3001/upload`
- POST multipart/form-data
- Direct upload for performance

## Development Workflow

```bash
# Start infrastructure
make infra-start

# Start backend services (separate terminals)
make gateway-dev
make ingestor-dev

# Start frontend (after all phases complete)
make web-dev

# Open browser
open http://localhost:3003
```

## Notes

- Each phase builds on the previous
- Execute phases sequentially
- Test after each phase if possible
- Manual testing only (no automated tests in MVP)
