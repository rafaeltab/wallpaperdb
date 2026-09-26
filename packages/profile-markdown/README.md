# Profile Markdown

The shared Biography policy gives the User service and web application one definition of accepted Markdown. It keeps server validation and browser rendering aligned while preserving the author's original text.

## Core capabilities

- Validates supported Markdown syntax, external HTTPS links, and Wallpaper references.
- Measures authored text in Unicode characters and keeps authoring limits separate from published content rendering.
- Normalizes link destinations and collects Wallpaper references for the User service's ownership checks.
- Prepares Wallpaper embeds and a sanitization policy for browser rendering.

Wallpaper embeds have their own navigation action and cannot act as external link labels. Authors can add a separate text link beside an image.

See the [shared policy decision](../../docs/adr/0005-share-the-profile-markdown-policy.md) for why validation and rendering must change together.
