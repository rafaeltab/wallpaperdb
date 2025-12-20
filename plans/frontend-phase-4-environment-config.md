# Phase 4: Environment Configuration & Documentation

**Status:** Partially Complete  
**Goal:** Complete environment configuration and documentation for the web application.

---

## Current Status

✅ **Already Complete:**
- Project setup (Phase 1)
- Core infrastructure (Phase 2)  
- Routes & components (Phase 3) - evolved beyond plan with additional features
- Application is functional and working
- `.gitignore` already configured at root level

❌ **Still Needed:**
- `.env.example` file
- Comprehensive `README.md` documentation

---

## Remaining Tasks

### Task 1: Create .env.example

**File:** `apps/web/.env.example`

```env
# Gateway GraphQL API URL
VITE_GATEWAY_URL=http://localhost:3000/graphql

# Ingestor REST API URL
VITE_INGESTOR_URL=http://localhost:3001
```

**Why:** Developers need a template to create their local `.env` file with the correct variable names.

---

### Task 2: Update README.md

**File:** `apps/web/README.md`

Replace the current stub README with comprehensive documentation.

**Current content:** 4-line placeholder  
**Needed content:** Full documentation covering:

```markdown
# @wallpaperdb/web

Frontend web application for WallpaperDB.

## Tech Stack

- **Framework:** Vite + React 19 + TypeScript
- **Routing:** TanStack Router (file-based, type-safe)
- **Data Fetching:** TanStack Query + graphql-request
- **Layout:** @wallpaperdb/react-muuri (Muuri grid layout)
- **Styling:** Tailwind CSS 4 + shadcn/ui components
- **Code Quality:** Biome

## Features

### Implemented
- ✅ Infinite scroll wallpaper browsing
- ✅ Multi-file upload queue (up to 200 files)
- ✅ Drag-and-drop upload
- ✅ Rate limit handling with automatic retry
- ✅ Duplicate detection
- ✅ Upload progress toast notifications
- ✅ Responsive sidebar navigation
- ✅ Theme toggle (light/dark mode)
- ✅ Masonry grid layout (via react-muuri)

### Planned
- Search functionality
- Filtering by dimensions/aspect ratio/format
- User authentication
- Wallpaper detail view
- Download variants

## Development

### Prerequisites

1. Infrastructure running: `make infra-start`
2. Gateway running: `make gateway-dev`
3. Ingestor running: `make ingestor-dev`

### Environment Setup

Copy `.env.example` to `.env`:

```bash
cd apps/web
cp .env.example .env
```

Default values work with local development infrastructure.

### Start Development Server

```bash
make web-dev
```

Open http://localhost:3005

### Available Commands

```bash
make web-dev        # Start dev server (port 3005)
make web-build      # Build for production
make web-preview    # Preview production build
make web-test       # Run tests
make web-format     # Format code with Biome
make web-lint       # Lint code with Biome
make web-check      # Type check with TypeScript
```

## Project Structure

```
src/
├── routes/              # TanStack Router routes (file-based)
│   ├── __root.tsx      # Root layout with sidebar
│   ├── index.tsx       # Home page (/) - infinite scroll
│   └── upload.tsx      # Upload page (/upload) - multi-file queue
├── components/
│   ├── grid/           # Grid layout components (react-muuri)
│   ├── upload/         # Upload queue components
│   ├── ui/             # shadcn/ui components
│   └── ...
├── contexts/
│   └── upload-queue-context.tsx  # Upload state management
├── hooks/
│   ├── useWallpaperInfiniteQuery.ts  # Infinite scroll query
│   └── useIntersectionObserver.ts    # Load more trigger
├── lib/
│   ├── graphql/        # GraphQL client, queries, types
│   └── api/            # REST API clients (Ingestor)
├── App.tsx             # App root with providers
├── main.tsx            # Entry point
└── index.css           # Global styles
```

## Backend Integration

### Gateway (GraphQL)
- **URL:** `http://localhost:3000/graphql`
- **Query:** `searchWallpapers` with cursor-based pagination
- **Returns:** Wallpapers with variants (url is computed field)

### Ingestor (REST)
- **URL:** `http://localhost:3001/upload`
- **Method:** POST multipart/form-data
- **Features:** Direct upload, rate limiting, duplicate detection

## Upload Queue

The upload page supports:
- **Multi-file selection:** Up to 200 files per batch
- **Drag-and-drop:** Drop files anywhere on the upload zone
- **Background processing:** Sequential upload with queue management
- **Rate limit handling:** Automatic pause/resume with countdown
- **Error recovery:** Retry failed uploads, clear duplicates
- **Progress tracking:** Toast notifications with file-level status

**File States:**
- `pending` - Waiting to upload
- `uploading` - Currently uploading
- `success` - Successfully uploaded
- `failed` - Upload failed (retryable)
- `duplicate` - File already exists (skipped)

## Development Tools

- **TanStack Query Devtools:** Bottom-left floating button
- **TanStack Router Devtools:** Bottom-right corner
- **React DevTools:** Browser extension recommended

## Type Safety

- TypeScript strict mode enabled
- TanStack Router provides route type safety
- Manual GraphQL types (synchronized with Gateway schema)

## Testing

Test infrastructure is set up with Vitest + React Testing Library:

```bash
make web-test        # Run all tests
make web-test:watch  # Run tests in watch mode
```

**Test Coverage:**
- Upload queue reducer
- Upload components (drop zone, toast)
- API client error handling
- Hooks (intersection observer)

## Troubleshooting

### Gateway Connection Error
**Problem:** Home page shows connection error  
**Solution:** Ensure Gateway is running (`make gateway-dev`) on port 3000

### Ingestor Upload Error
**Problem:** Upload fails with connection error  
**Solution:** Ensure Ingestor is running (`make ingestor-dev`) on port 3001

### No Wallpapers Display
**Problem:** Home page shows "No wallpapers found"  
**Solution:** Upload a wallpaper first, or check Gateway has data in OpenSearch

### TypeScript Errors
**Problem:** `make web-check` shows errors  
**Solution:** Check import paths use `@/` alias, run `pnpm install`

### Styles Not Applied
**Problem:** Tailwind styles missing  
**Solution:** Restart dev server, check Tailwind config

### Route Not Found
**Problem:** TanStack Router error  
**Solution:** Check `routeTree.gen.ts` was generated, restart dev server

## Architecture Notes

### Why React Muuri?
The home page uses `@wallpaperdb/react-muuri` for masonry grid layout:
- Automatic spacing and positioning
- Responsive to different wallpaper aspect ratios
- Smooth animations
- Optimized for performance

### Why Infinite Scroll?
Instead of traditional pagination:
- Better UX for browsing large collections
- Cursor-based pagination (Relay spec)
- Automatic fetch on scroll
- Preserves scroll position on back navigation

### Why Upload Queue?
Multi-file upload with queue management:
- Sequential uploads avoid overwhelming the server
- Rate limit handling prevents errors
- Background processing improves UX
- Resilient to network issues

## Future Enhancements

1. **Authentication:**
   - User login/signup
   - JWT token management
   - User-specific wallpaper filtering

2. **Search & Filtering:**
   - Full-text search
   - Filter by dimensions, aspect ratio, format
   - Tag-based filtering (when tagging service is ready)

3. **Performance:**
   - Virtual scrolling for very large collections
   - Service worker for offline support
   - Image CDN integration

4. **Developer Experience:**
   - GraphQL code generation (graphql-codegen)
   - Storybook for component development
   - E2E tests with Playwright

---

## Related Documentation

- **Multi-file Upload:** `plans/done/multi-file-upload.md`
- **React Muuri Package:** `plans/done/react-muuri.md`
- **Frontend Overview:** `plans/frontend-overview.md`
- **Services:** `plans/services.md`
```

---

## Verification Checklist

After completing these tasks:

- [ ] `.env.example` exists in `apps/web/`
- [ ] Developers can run `cp .env.example .env` to get started
- [ ] `README.md` comprehensively documents the application
- [ ] README includes all implemented features
- [ ] README includes setup instructions
- [ ] README includes troubleshooting guide

---

## Estimated Time

- Create `.env.example`: 2 minutes
- Write comprehensive `README.md`: 15-20 minutes
- **Total: ~20 minutes**

---

## Notes

The web application has evolved significantly beyond the original Phase 3 plan:
- Added infinite scroll with cursor-based pagination
- Integrated multi-file upload queue (separate plan)
- Added sidebar navigation and theme toggle
- Integrated `@wallpaperdb/react-muuri` for grid layout
- Added comprehensive testing infrastructure

This is a **positive evolution** - the app is more feature-rich and production-ready. The documentation should reflect the current state, not the original plan.
