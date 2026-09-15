# Profile Markdown

The shared Biography policy keeps Profile authoring and public rendering aligned. It gives the User service and web application one definition of safe Markdown while preserving the author's original text.

- Validates supported syntax, external destinations, and Wallpaper references.
- Measures authored text in Unicode characters and separates authoring limits from published content validation.
- Provides normalized link destinations and the Wallpaper references needed for ownership checks.
- Prepares dedicated Wallpaper elements and a narrow sanitization policy for safe rendering.

CommonMark and GitHub Flavored Markdown parsing use the unified and remark ecosystem. A shared remark plugin and rehype sanitization schema support direct React rendering without persisting generated HTML.
