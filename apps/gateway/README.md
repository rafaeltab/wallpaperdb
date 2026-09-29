# Gateway

Gateway lets visitors discover wallpapers and contributor Profiles through a catalogue built from facts published by their owning services. It owns public search and presentation; the publishing services remain responsible for the underlying records.

## Core capabilities

- Search wallpapers by contributor, rendition dimensions, aspect ratio, and format, with color preference ranking and pagination.
- Retrieve wallpapers with their contributor Profiles and media URLs.
- Find Profiles by Handle, active alias, or Display name, and resolve earlier Handles to the current Profile address.
- Keep the catalogue up to date as wallpapers, variants, colors, and Profiles are published, without allowing replayed events to undo newer state.
- Limit query complexity, visitor cost budgets, and active GraphQL work to protect public discovery.

## Technology choices

OpenSearch supports the catalogue's filtered and ranked searches. Mercurius exposes the catalogue through GraphQL, and Redis coordinates visitor quotas across Gateway replicas.

Read the [domain context](CONTEXT.md) for ownership and the [recovery guide](../docs/content/docs/guides/service-upgrades.mdx) before rebuilding projections or replaying messages.

The [admission contract](../docs/content/docs/guides/gateway-admission.mdx) explains quota and overload responses, degraded operation, and required production ingress controls. [Load evidence](docs/admission-load-test.md) records initial limits and the checks required before deployment.

