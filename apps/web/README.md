# @wallpaperdb/web

The React-based frontend for WallpaperDB, giving users browsing, upload, and Profile settings backed by the Gateway, Ingestor, and User services.

## Key Capabilities

- **Wallpaper gallery** — infinite-scroll masonry grid that fetches wallpapers via cursor-based pagination from the Gateway's GraphQL API
- **Wallpaper detail view** — full-screen display of a wallpaper with contributor attribution, variant selection, download-by-variant, sharing, and a collapsible metadata panel; supports keyboard shortcuts
- **Public contributor Profiles** — canonical Handle routes show public identity and an infinitely paginated gallery of the contributor's wallpapers
- **Profile editing** — an overview matching the public profile, with inline display name, profile handle, and Markdown biography edits; picture and previous-handle dialogs; saved-profile previews; and draft-preserving error recovery
- **Multi-file upload queue** — drag-and-drop or file-picker upload that processes files sequentially, surfaces per-file status (pending, uploading, success, failed, duplicate), and automatically pauses and resumes the queue when the Ingestor reports a rate limit
- **Theme support** — light, dark, and system-preference themes persisted across sessions
- **Shared notifications** — profile feedback and upload progress use one themed notification stack at the bottom right

## Profile Editor

Open **Your profile** from the navigation menu, then **Edit profile**. The [profile editing guide](../docs/content/docs/guides/profile-editing.mdx) describes saving, cooldowns, aliases, and picture changes.

`ProfileOverview` supplies the shared public, editing, and preview layout. `ProfileInlineField` owns inline drafts, validation, versioned saves, and conflict recovery. `ProfilePictureSettings` and `ProfileAliasSettings` contain their respective dialogs and commands.

Profile commands use the authenticated User REST API and replace the owner query cache with the accepted response. Mutations share the owner query key so writes and refreshes cannot overwrite each other. Dirty inline drafts retain their original version until the author explicitly refreshes after a conflict. Public reads still use the Gateway projection, which may take a moment to catch up.

## Technology Choices

- **Vite + React 19** — build tooling and UI framework
- **TanStack Router** — file-based, fully type-safe client-side routing with automatic route tree generation
- **TanStack Query** — server-state management with stale-while-revalidate caching; query invalidation on upload completion keeps the gallery in sync
- **graphql-request** — lightweight GraphQL client for communication with the Gateway
- **`@wallpaperdb/react-muuri`** — workspace-local wrapper around Muuri that drives the masonry grid layout, handling variable aspect ratios and responsive reflow
- **Tailwind CSS v4 + shadcn/ui** — utility-first styling with a component library built on Radix UI primitives
- **Vitest + React Testing Library** — unit and component tests, including reducer logic and upload UI behaviour
