# Local infrastructure

Docker Compose supplies the shared development dependencies. Follow [contributor setup](../CONTRIBUTING.md) for installation, worktree isolation, and teardown. Connection settings come from generated environments; the Compose files and Caddy configuration define services and routes.

Existing data needs explicit care during upgrades. See [storage migration](../apps/docs/content/docs/infrastructure/seaweedfs.mdx) and [service recovery](../apps/docs/content/docs/guides/service-upgrades.mdx) before replacing storage or replaying messages. Infrastructure reset is destructive and is not an upgrade procedure.

Profile pictures belong in a private bucket. User owns their state; Media checks User before serving them. Custom deployments must preserve that separation and configure the same service token on both sides, as described in the recovery guide.
