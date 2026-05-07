# @wallpaperdb/user

Manages user identities within WallpaperDB by processing Clerk webhook events for sign-ups and profile changes, persisting user data to PostgreSQL, and publishing user events via NATS for downstream consumers.

## Key Capabilities

- Receives and processes Clerk webhooks for user lifecycle events (sign-up, profile update, deletion)
- Persists user profiles and identity data to a dedicated PostgreSQL database
- Publishes domain events to NATS when user state changes, enabling downstream services to react without direct coupling
- Provides health and readiness endpoints for infrastructure monitoring

## Technology Choices

- **Clerk** as the external identity provider — the service consumes webhook events rather than managing authentication itself
- **TSyringe** for dependency injection, following the same pattern as other WallpaperDB services
