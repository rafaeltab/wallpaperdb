# @wallpaperdb/web

The React-based frontend for WallpaperDB, giving users a browsing and upload interface backed by the Gateway and Ingestor services.

## Key Capabilities

- **Wallpaper gallery** — infinite-scroll masonry grid that fetches wallpapers via cursor-based pagination from the Gateway's GraphQL API
- **Wallpaper detail view** — full-screen display of a wallpaper with variant selection, download-by-variant, sharing, and a collapsible metadata panel; supports keyboard shortcuts
- **Multi-file upload queue** — drag-and-drop or file-picker upload that processes files sequentially, surfaces per-file status (pending, uploading, success, failed, duplicate), and automatically pauses and resumes the queue when the Ingestor reports a rate limit
- **Theme support** — light, dark, and system-preference themes persisted across sessions

## Technology Choices

- **Vite + React 19** — build tooling and UI framework
- **TanStack Router** — file-based, fully type-safe client-side routing with automatic route tree generation
- **TanStack Query** — server-state management with stale-while-revalidate caching; query invalidation on upload completion keeps the gallery in sync
- **graphql-request** — lightweight GraphQL client for communication with the Gateway
- **`@wallpaperdb/react-muuri`** — workspace-local wrapper around Muuri that drives the masonry grid layout, handling variable aspect ratios and responsive reflow
- **Tailwind CSS v4 + shadcn/ui** — utility-first styling with a component library built on Radix UI primitives
- **Vitest + React Testing Library** — unit and component tests, including reducer logic and upload UI behaviour
