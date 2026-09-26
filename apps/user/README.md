# User

User owns contributor Profiles and the rules for changing public identity, including Handles, aliases, Biographies, and Profile pictures. Other services consume its announcements; they do not decide Profile state.

## Core capabilities

- Create a Profile from an authenticated identity, with a generated fallback when identity details are absent.
- Edit Display names and Markdown Biographies with ownership checks and conflict detection, including validation of embedded wallpapers.
- Change Handles while preserving earlier addresses as aliases, with controls for alias expiry and reactivation.
- Import, validate, replace, and remove Profile pictures without allowing delayed imports to overwrite manual choices.
- Authorize delivery of the current Profile picture, retry interrupted imports, and clean up unused picture assets.
- Publish accepted Profile changes and expire eligible event history while preserving current state and undelivered announcements.

## Technology choices

Clerk supplies authenticated identities. PostgreSQL owns Profile state and exclusive Handle claims. Sharp decodes Profile pictures into metadata-free images in an isolated process so expensive native work can be stopped.

See the [domain context](CONTEXT.md) for terminology and invariants, the [profile editing guide](../docs/content/docs/guides/profile-editing.mdx) for user behavior, and the [upgrade procedures](../docs/content/docs/guides/service-upgrades.mdx) for existing installations.
