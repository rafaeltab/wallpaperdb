# Local infrastructure

Docker Compose supplies development dependencies. See [contributor setup](../CONTRIBUTING.md) for installation, worktree isolation, and teardown. Generated environments provide connection settings; Compose and Caddy configuration define services and routes.

Local Caddy supports development routing. Production ingress must satisfy the [admission deployment contract](../apps/docs/content/docs/guides/gateway-admission.mdx), including raw-request and body-size limits, trusted client-IP forwarding, and restricted direct access. No production ingress product is selected.

Read [storage migration](../apps/docs/content/docs/infrastructure/seaweedfs.mdx) and [service recovery](../apps/docs/content/docs/guides/service-upgrades.mdx) before replacing storage or replaying messages. Infrastructure reset destroys data and is not an upgrade procedure.

Profile pictures require a private bucket. User owns their state; Asset checks User before delivery. Custom deployments must preserve this separation and configure the same service token on both sides, as described in the recovery guide.
