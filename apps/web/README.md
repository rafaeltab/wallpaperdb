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

Local static Profile picture sources follow [Ingestor's dimension admission limits](../ingestor/src/capabilities/ingestion/implementation.ts) to bound decoding before canonical reduction. The [browser source inspector](src/features/picture-editor/adapters/source.ts) checks headers before starting either decoder. The effective User picture policy remains authoritative for the processed upload.

## Frontend feature decisions

Feature policies use plain TypeScript, while React and browser adapters handle rendering and effects. See the [coding guidelines index](../../CODING_STANDARDS.md) for frontend guidance and the [architecture test](test/features/feature-architecture.test.ts) for enforced feature boundaries.
