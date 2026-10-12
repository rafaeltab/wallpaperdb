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

The SDR editor rejects JPEG gain-map declarations and PNG `cICP` color declarations before rasterization. Unqualified HDR sources must not silently become SDR uploads; [ADR 0009](../../docs/adr/0009-process-temporary-hdr-profile-picture-sources-in-media.md) assigns HDR processing to Media, and the [confirmed source policy](https://github.com/rafaeltab/wallpaperdb/issues/270#issuecomment-5902621514) requires classification before SDR normalization.

## Frontend feature decisions

Feature policies use plain TypeScript, while React and browser adapters handle rendering and effects. See the [coding guidelines index](../../CODING_STANDARDS.md) for frontend guidance and the [architecture test](test/features/feature-architecture.test.ts) for enforced feature boundaries.

Picture processing contracts use real Chromium because GIF composition, Canvas encoding, workers, and cancellation require browser APIs. The [browser contract configuration](vitest.browser.config.ts) runs separately from the successful service journeys through the workspace's [integration script](package.json), so failure and timing cases do not expand the service journey matrix.
