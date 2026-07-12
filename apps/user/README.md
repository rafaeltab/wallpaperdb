# @wallpaperdb/user

Owns WallpaperDB Profiles: the public identity a signed-in User presents to the community.

## Key Capabilities

- Verifies Clerk JWTs on authenticated Profile commands
- Lazily creates a Profile from a one-time Clerk identity lookup
- Persists authoritative Profile state, Handle claims, and transactional-outbox events in PostgreSQL
- Keeps WallpaperDB-owned Profile fields independent from later Clerk changes
- Provides health and readiness endpoints for infrastructure monitoring

## Technology Choices

- **Clerk** as the authentication and initial identity provider
- **TSyringe** for dependency injection, following the same pattern as other WallpaperDB services
