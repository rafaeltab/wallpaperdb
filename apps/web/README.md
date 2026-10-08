# Web

The browser application lets people discover wallpapers, upload their own, and manage contributor Profiles.

## Core capabilities

- Browse an infinite-scroll masonry gallery, filter by contributor, format, and aspect ratio, and rank results by color preference.
- View wallpapers with contributor attribution and metadata, compare available renditions, download a selected size, and share links.
- Upload multiple files with per-file progress and results, retry failures, and pause or resume the queue when an upload quota applies.
- Visit public contributor Profiles and browse their wallpapers through current Handles and active aliases.
- Edit Display names, Handles, and Markdown Biographies; manage pictures and previous Handles; preview saved Profiles and preserve drafts when edits conflict.
- Choose light, dark, or system appearance and retain the preference between visits.

## Technology choices

React and TanStack Router provide the application and its navigation. TanStack Query manages service data and refreshes after accepted changes. The workspace's [React Muuri wrapper](../../packages/react-muuri/README.md) provides the masonry gallery layout.

Profile edits go to the owning User service; public pages read Gateway's projection, which can take a moment to catch up. See the [profile editing guide](../docs/content/docs/guides/profile-editing.mdx) for saving, aliases, cooldowns, and picture changes.

## Frontend feature decisions

Feature decisions are plain TypeScript behind public entries under [src/features](src/features). Pure policies cover browse filters and colors, feed errors, grid sizing and packing, wallpaper actions, authentication stages, Profile management and public projections, request admission, and appearance preferences. The upload queue and inline Profile editor use workflows because they coordinate asynchronous requests, drafts, conflicts, cooldowns, and cancellation.

React owns rendering, focus, gestures, and local UI state. TanStack Router owns URL state, TanStack Query owns service data, and Clerk owns authentication. Adapters translate those systems into feature inputs and execute browser effects. Profile mutation responses update only the query object for the session that started the request, even if navigation unmounts the editor. Simple browser hooks and presentational components retain their existing structure.

Tests under [test/features](test/features) exercise public decisions and workflows with controlled inputs and adapters. React and Query tests cover composition, focus, and cache ownership. Browser journeys cover measurements, animation, navigation, and complete interactions. The [architecture test](test/features/feature-architecture.test.ts) discovers feature directories, enforces their public entries, and prevents their cores from importing framework or browser dependencies. Shared pure Markdown policy and GraphQL value types are explicit exceptions.

A workflow is justified by coordination behavior; straightforward decisions stay functions, and UI components do not need an extra store.
