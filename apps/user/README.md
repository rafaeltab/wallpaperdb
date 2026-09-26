# @wallpaperdb/user

Owns WallpaperDB Profiles and the rules for changing a contributor's public identity. It turns authenticated User choices into authoritative Profile state and durable announcements for other services.

## Key capabilities

- Creates a Profile once from an external identity or a generated fallback.
- Edits Display names and Biographies with ownership checks and conflict detection.
- Changes Handles while preserving earlier addresses as aliases and managing their expiry and reactivation.
- Imports, validates, replaces, and removes Profile pictures without allowing delayed imports to overwrite manual choices.
- Authorizes delivery of the current picture and recovers interrupted private-object workflows.
- Publishes accepted Profile changes and expires eligible evidence while preserving current state and undelivered events.

## Component choices

Clerk supplies authenticated identities. PostgreSQL owns Profile state and exclusive Handle claims. Sharp decodes pictures into metadata-free images inside an isolated process so expensive native work can be stopped.
