# @wallpaperdb/user

Owns WallpaperDB Profiles. It verifies Clerk-authenticated Users, persists public Profile state in PostgreSQL, and records typed Profile events for downstream consumers.

## Key Capabilities

- Idempotently creates or returns the signed-in User's Profile through `POST /profile/me/ensure`
- Safely edits Display names through `PATCH /profile/me` with optimistic concurrency
- Derives unique, configurable Handles with monotonic claim generations from Clerk identity data or a generated fallback
- Atomically persists Profile state, Handle claims, and typed outbox events for creation and updates
- Provides health and readiness endpoints for infrastructure monitoring

## Technology Choices

- **Clerk** as the external identity provider and JWT authority; Clerk user IDs are Profile IDs
- **PostgreSQL** as the authority for Profile state and case-insensitive Handle claims
- **TSyringe** for dependency injection, following the same pattern as other WallpaperDB services
