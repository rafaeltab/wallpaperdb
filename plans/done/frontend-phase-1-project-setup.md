# Phase 1: Project Setup

**Goal:** Create the `apps/web/` directory structure, configuration files, and install dependencies.

---

## Prerequisites

- None (first phase)

---

## Tasks

### 1.1 Create Directory Structure

Create the following directory structure:

```
apps/web/
├── src/
│   ├── routes/
│   ├── lib/
│   │   ├── graphql/
│   │   └── api/
│   └── components/
│       └── ui/
├── public/
└── [config files at root]
```

**Commands:**
```bash
mkdir -p apps/web/src/routes
mkdir -p apps/web/src/lib/graphql
mkdir -p apps/web/src/lib/api
mkdir -p apps/web/src/components/ui
mkdir -p apps/web/public
```

---

### 1.2 Create package.json

**File:** `apps/web/package.json`

```json
{
  "name": "@wallpaperdb/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 3005",
    "build": "tsc && vite build",
    "preview": "vite preview --port 3005",
    "format": "biome format --write .",
    "lint": "biome lint .",
    "check": "biome check --write .",
    "check-types": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tanstack/react-router": "^1.99.2",
    "@tanstack/react-query": "^5.62.11",
    "@tanstack/router-devtools": "^1.99.2",
    "@tanstack/query-devtools": "^5.62.11",
    "graphql": "^16.10.0",
    "graphql-request": "^7.1.2"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.0.5",
    "typescript": "^5.7.2",
    "@tanstack/router-plugin": "^1.99.1",
    "tailwindcss": "^4.0.0",
    "postcss": "^8.5.1",
    "autoprefixer": "^10.4.20",
    "@biomejs/biome": "workspace:*"
  }
}
```

---

### 1.3 Create Vite Configuration

**File:** `apps/web/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [
    TanStackRouterVite(),  // Auto-generates route tree
    react(),
  ],
  server: {
    port: 3005,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

---

### 1.4 Create TypeScript Configurations

**File:** `apps/web/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "jsx": "react-jsx",
    "strict": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

**File:** `apps/web/tsconfig.node.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}
```

---

### 1.5 Create Tailwind Configuration

**File:** `apps/web/tailwind.config.ts`

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
```

**File:** `apps/web/postcss.config.mjs`

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

---

### 1.6 Create Biome Configuration

**File:** `apps/web/biome.json`

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false,
    "ignore": ["node_modules", "dist", "build", ".next", "coverage"]
  },
  "formatter": {
    "enabled": true,
    "lineWidth": 100,
    "indentStyle": "space",
    "indentWidth": 2
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "warn"
      },
      "a11y": {
        "recommended": true
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always",
      "trailingCommas": "es5"
    }
  }
}
```

---

### 1.7 Add Makefile Targets

**File:** `Makefile` (append to existing file)

Add these targets to the Makefile:

```makefile
# Web frontend commands
web-dev:
	@turbo run dev --filter=@wallpaperdb/web

web-build:
	@turbo run build --filter=@wallpaperdb/web

web-preview:
	@turbo run preview --filter=@wallpaperdb/web

web-format:
	@turbo run format --filter=@wallpaperdb/web

web-lint:
	@turbo run lint --filter=@wallpaperdb/web

web-check:
	@turbo run check-types --filter=@wallpaperdb/web
```

Also add these to the `.PHONY` declaration at the top of the Makefile:
```makefile
.PHONY: ... web-dev web-build web-preview web-format web-lint web-check
```

---

### 1.8 Install Dependencies

Run from repository root:

```bash
pnpm install
```

This will install all dependencies for the new `@wallpaperdb/web` workspace.

---

## Files Created

- `apps/web/package.json`
- `apps/web/vite.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.node.json`
- `apps/web/tailwind.config.ts`
- `apps/web/postcss.config.mjs`
- `apps/web/biome.json`

## Files Modified

- `Makefile` (added web-* targets)

---

## Verification

After completing this phase:

1. Check dependencies installed: `ls apps/web/node_modules` (or check pnpm output)
2. Verify TypeScript config: `make web-check` (should pass with no files yet)
3. Verify Biome works: `make web-format` (should run without errors)

---

## Next Phase

**Phase 2:** Core Infrastructure (`frontend-phase-2-core-infrastructure.md`)
- GraphQL client setup
- TanStack Query configuration
- Type definitions
- Ingestor upload client
