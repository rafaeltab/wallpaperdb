# Local infrastructure

Docker Compose supplies the shared development dependencies. Follow [contributor setup](../CONTRIBUTING.md) for installation, worktree isolation, and teardown. Connection settings come from generated environments; the Compose files and Caddy configuration define services and routes.

Local Caddy is a development routing aid. A production gateway ingress must separately satisfy the [admission deployment contract](../apps/docs/content/docs/guides/gateway-admission.mdx), including raw-request and body-size limits, trusted client-IP forwarding, and restricted direct access. No production ingress product is selected.

Existing data needs explicit care during upgrades. See [storage migration](../apps/docs/content/docs/infrastructure/seaweedfs.mdx) and [service recovery](../apps/docs/content/docs/guides/service-upgrades.mdx) before replacing storage or replaying messages. Infrastructure reset is destructive and is not an upgrade procedure.

Profile pictures belong in a private bucket. User owns their state; Media checks User before serving them. Custom deployments must preserve that separation and configure the same service token on both sides, as described in the recovery guide.
