# @wallpaperdb/user

Owns WallpaperDB Profiles. It verifies Clerk-authenticated Users, persists public Profile state in PostgreSQL, and records typed Profile events for downstream consumers.

## Key Capabilities

- Idempotently creates or returns the signed-in User's Profile through `POST /profile/me/ensure`
- Changes Handles through `PUT /profile/me/handle`, preserving former addresses as aliases and enforcing a seven-day cooldown
- Schedules alias removal with a 24-hour grace period and releases claims automatically or through a confirmed immediate-expiry command
- Reactivates eligible historical Handles from the configured event window (30 days by default), including canceling scheduled alias expiry
- Safely edits Display names through `PATCH /profile/me` with optimistic concurrency
- Imports the initial Clerk picture asynchronously and accepts validated picture uploads and removal with optimistic concurrency
- Keeps picture objects private and authorizes Media delivery only for the current asset
- Validates authored Biography Markdown through the shared Profile policy and checks wallpaper embeds against an event-fed ownership projection
- Derives unique, configurable Handles with monotonic claim generations from Clerk identity data or a generated fallback
- Atomically persists Profile state, Handle claims, and typed outbox events for creation and updates
- Expires published Profile event details and private staged/retired picture assets, preserving unpublished events, current state, and active pictures
- Provides health and readiness endpoints for infrastructure monitoring

## Technology Choices

- **Clerk** as the external identity provider and JWT authority; Clerk user IDs are Profile IDs
- **PostgreSQL** as the authority for Profile state and case-insensitive Handle claims
- **TSyringe** for dependency injection, following the same pattern as other WallpaperDB services

## Evidence Retention

`PROFILE_EVIDENCE_RETENTION_DAYS` is a positive integer, defaulting to 30. Profile events remain eligible for Handle history strictly before their retention deadline. Cleanup removes expired event rows only after acknowledged NATS publication; an old unpublished row remains available for delivery without extending Handle eligibility.

Staged and retired pictures stay in the private picture bucket until their recorded expiry, then cleanup deletes their objects. New asset deadlines use the configured window; existing recorded deadlines are preserved when configuration changes. Active pictures, current Profiles, Handle claims, aliases, and read-model projections remain intact.

NATS projection history remains indefinitely retained under the temporary policy reviewed in [#162](https://github.com/rafaeltab/wallpaperdb/issues/162). Evidence cleanup does not implement cross-system erasure or recall copies already cached by a browser or CDN.
