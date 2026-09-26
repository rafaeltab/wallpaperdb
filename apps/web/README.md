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
