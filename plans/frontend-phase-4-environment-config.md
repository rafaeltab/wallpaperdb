# Phase 4: Environment Configuration

**Goal:** Create environment variable templates and update .gitignore to ensure proper configuration management.

---

## Prerequisites

- **Phase 1 complete:** Project setup
- **Phase 2 complete:** Core infrastructure
- **Phase 3 complete:** Routes & components

---

## Tasks

### 4.1 Create .env.example

**File:** `apps/web/.env.example`

```
# Gateway GraphQL API URL
VITE_GATEWAY_URL=http://localhost:3000/graphql

# Ingestor REST API URL
VITE_INGESTOR_URL=http://localhost:3001
```

---

### 4.2 Create Local .env File

**File:** `apps/web/.env` (developer creates locally, not committed to git)

```
# Gateway GraphQL API URL
VITE_GATEWAY_URL=http://localhost:3000/graphql

# Ingestor REST API URL
VITE_INGESTOR_URL=http://localhost:3001
```

**Note:** This file is gitignored and each developer creates their own copy.

---

### 4.3 Update .gitignore

**Check root `.gitignore`** to ensure it contains:

```
# Environment files
.env
.env.local
.env.*.local

# Build outputs
dist
build
.next

# Vite
.vite

# TanStack Router generated files
**/routeTree.gen.ts
```

If not present, add these lines to the root `.gitignore`.

---

### 4.4 Create README for Web App (Optional)

**File:** `apps/web/README.md`

```markdown
# @wallpaperdb/web

Frontend web application for WallpaperDB.

## Tech Stack

- **Framework:** Vite + React 19 + TypeScript
- **Routing:** TanStack Router (file-based, type-safe)
- **Data Fetching:** TanStack Query + graphql-request
- **Styling:** Tailwind CSS 4
- **Code Quality:** Biome

## Development

### Prerequisites

1. Infrastructure running: `make infra-start`
2. Gateway running: `make gateway-dev`
3. Ingestor running: `make ingestor-dev`

### Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Default values work with local development infrastructure.

### Start Development Server

```bash
make web-dev
```

Open http://localhost:3003

### Available Commands

```bash
make web-dev        # Start dev server (port 3003)
make web-build      # Build for production
make web-preview    # Preview production build
make web-format     # Format code with Biome
make web-lint       # Lint code with Biome
make web-check      # Type check with TypeScript
```

## Project Structure

```
src/
├── routes/              # TanStack Router routes
│   ├── __root.tsx      # Root layout
│   ├── index.tsx       # Home page (/)
│   └── upload.tsx      # Upload page (/upload)
├── lib/
│   ├── graphql/        # GraphQL client and queries
│   └── api/            # REST API clients (Ingestor)
├── components/         # Reusable components
├── App.tsx             # App root with providers
├── main.tsx            # Entry point
└── index.css           # Global styles
```

## Features

### Home Page (`/`)
- Browse wallpapers from Gateway GraphQL API
- Grid layout with responsive design
- Shows variant count and upload date

### Upload Page (`/upload`)
- Upload images or videos to Ingestor
- File preview for images
- Progress feedback during upload

## Backend Integration

### Gateway (GraphQL)
- URL: `http://localhost:3000/graphql`
- Query: `searchWallpapers` with cursor-based pagination
- Returns wallpapers with variants (url is computed field)

### Ingestor (REST)
- URL: `http://localhost:3001/upload`
- POST multipart/form-data
- Direct upload for performance

## Development Tools

- **TanStack Query Devtools:** Bottom floating button (React Query logo)
- **TanStack Router Devtools:** Bottom-right corner

## Type Safety

- TypeScript strict mode enabled
- TanStack Router provides route type safety
- Manual GraphQL types (future: codegen)

## Future Enhancements

- Authentication (user login)
- Filtering and search
- Pagination (infinite scroll)
- Detail view (full-screen wallpaper)
- Upload progress bar
- Toast notifications
- Dark mode
- Testing (Vitest + React Testing Library)
```

---

## Files Created

- `apps/web/.env.example`
- `apps/web/.env` (local only, not committed)
- `apps/web/README.md` (optional)

## Files Modified

- `.gitignore` (root, if needed)

---

## Final Verification

### 1. Environment Setup

Create local `.env`:
```bash
cd apps/web
cp .env.example .env
```

### 2. Full Stack Test

**Terminal 1:** Start infrastructure
```bash
make infra-start
```

**Terminal 2:** Start Gateway
```bash
make gateway-dev
```

**Terminal 3:** Start Ingestor
```bash
make ingestor-dev
```

**Terminal 4:** Start frontend
```bash
make web-dev
```

**Browser:** Open http://localhost:3003

### 3. Test Scenarios

**Browse Wallpapers:**
1. Navigate to home page (`/`)
2. If no wallpapers exist, you'll see "No wallpapers found"
3. Click "Upload your first wallpaper"

**Upload Wallpaper:**
1. Navigate to upload page (`/upload`)
2. Select an image file
3. Preview should appear
4. Click "Upload"
5. Should redirect to home page
6. Uploaded wallpaper should appear in grid

**DevTools:**
1. Check TanStack Query devtools (bottom floating button)
2. Check TanStack Router devtools (bottom-right corner)
3. Verify queries and cache behavior

### 4. Code Quality

```bash
make web-check      # TypeScript should pass with no errors
make web-format     # Biome formatting should pass
make web-lint       # Biome linting should pass
```

---

## Success Criteria (All Phases Complete)

✅ **Phase 1:** Project setup complete
- Directory structure created
- Configuration files in place
- Dependencies installed
- Makefile targets added

✅ **Phase 2:** Core infrastructure complete
- GraphQL client configured
- TanStack Query setup
- Type definitions created
- Ingestor upload client ready

✅ **Phase 3:** Routes & components complete
- Root layout with navigation
- Home page displays wallpapers
- Upload page works
- HTML entry point created

✅ **Phase 4:** Environment configuration complete
- .env.example created
- .gitignore updated
- README documentation (optional)

✅ **Full Application Working:**
- `make web-dev` starts dev server on port 3003
- Home page fetches wallpapers from Gateway
- Upload page sends files to Ingestor
- Navigation works smoothly
- Tailwind CSS styling applied
- TypeScript strict mode, no errors
- Biome formatting/linting passes

---

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
**Solution:** Ensure all phases complete, check import paths use `@/` alias

### Tailwind Not Working
**Problem:** Styles not applied
**Solution:** Check `postcss.config.mjs` exists, restart dev server

### Route Not Found
**Problem:** TanStack Router error
**Solution:** Check `routeTree.gen.ts` was generated, restart dev server

---

## Next Steps (Future Development)

After completing all phases, consider:

1. **Authentication:**
   - Add user login/signup
   - Pass auth tokens to Gateway/Ingestor
   - User-specific wallpaper filtering

2. **Enhanced UI:**
   - Filtering by dimensions, aspect ratio, format
   - Search functionality
   - Pagination or infinite scroll
   - Detail view for wallpapers

3. **Testing:**
   - Vitest unit tests for utilities
   - React Testing Library for components
   - MSW for API mocking
   - Playwright E2E tests

4. **Performance:**
   - Image lazy loading (already implemented)
   - Virtual scrolling for large lists
   - Service worker for offline support

5. **Developer Experience:**
   - GraphQL code generation (graphql-codegen)
   - Storybook for component development
   - Chromatic for visual regression testing

---

## Documentation

- **Overview:** `plans/frontend-overview.md`
- **Phase 1:** `plans/frontend-phase-1-project-setup.md`
- **Phase 2:** `plans/frontend-phase-2-core-infrastructure.md`
- **Phase 3:** `plans/frontend-phase-3-routes-components.md`
- **Phase 4:** `plans/frontend-phase-4-environment-config.md` (this file)

All phases complete! 🎉
