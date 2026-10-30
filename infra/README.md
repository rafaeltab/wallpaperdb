# Local infrastructure

Docker Compose supplies the shared development dependencies. Follow [contributor setup](../CONTRIBUTING.md) for installation, worktree isolation, and teardown. Connection settings come from generated environments; the Compose files and Caddy configuration define services and routes.

Local Caddy is a development routing aid. A production gateway ingress must separately satisfy the [admission decision](../apps/gateway/docs/adr/0003-weighted-ip-admission-with-bounded-fallback.md), including raw-request and body-size limits, trusted client-IP forwarding, and restricted direct access. No production ingress product is selected.

Existing data needs explicit care during upgrades. Read the [storage decision](../docs/adr/0003-use-seaweedfs-for-local-and-test-object-storage.md) and the relevant context ADRs before replacing storage or replaying messages. Infrastructure reset is destructive and is not an upgrade procedure.

Profile pictures belong in a private bucket. User owns their state; Asset checks User before serving them. Custom deployments must preserve that separation and configure the same service token on both sides, as recorded in the [picture delivery decision](../docs/adr/0004-authorize-profile-picture-delivery-at-origin.md).
