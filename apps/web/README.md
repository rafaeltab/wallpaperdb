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

## Frontend feature pilots

The upload queue and inline Profile editor separate interaction decisions from React so request ordering, draft conflicts, cooldowns, and cancellation can be tested without mounting the application. Their public workflows accept controlled adapters; React subscribes to snapshots and owns browser focus. TanStack Query continues to own server data. Profile save responses update only the query object for the session that started the request, even if navigation unmounts the editor.

The grid layout pilot separates rectangle packing and expanded-item placement from DOM measurement. Geometry invariants belong in its pure tests; the Muuri adapter translates measured items and applies the resulting slots. Real-browser verification remains necessary for measurement, animation, and focus.

See the [upload workflow](src/features/upload-queue/index.ts), [Profile editor workflow](src/features/profile-editor/index.ts), and [grid layout](src/features/grid-layout/index.ts), with public-interface tests under [test/features](test/features). Existing Profile UI tests and upload provider/page tests cover the React and cache connections. The [architecture test](test/features/feature-architecture.test.ts) enforces dependency direction and public entry points, allowing the Profile editor's shared pure Markdown policy. These are pilots for substantial behavior, not a required structure for every component.
