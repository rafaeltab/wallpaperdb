# Gateway

Gateway owns public wallpaper and contributor discovery through a catalogue of facts published by their owning services.

- Search wallpapers by contributor, dimensions, aspect ratio and format, with [color ranking](src/graphql/schema.ts) and pagination.
- Retrieve wallpaper metadata, contributor Profiles and asset URLs.
- Find Profiles by Handle, active alias or Display name, and redirect earlier Handles.
- Project wallpaper, variant, color and Profile events without letting replay undo newer state.
- Bound query complexity, visitor cost and active GraphQL work.

OpenSearch provides search, Mercurius exposes GraphQL, and Redis shares visitor quotas across replicas. Read the [domain context](GLOSSARY.md) and [recovery guide](../docs/content/docs/guides/service-upgrades.mdx) before rebuilding projections or replaying events. The [admission contract](../docs/content/docs/guides/gateway-admission.mdx) covers quota responses, degraded operation and production ingress controls; [load evidence](docs/admission-load-test.md) records initial limits and deployment checks.

Gateway serves Swagger UI at `/documentation` and OpenAPI at `/documentation/json`, registered by the [HTTP adapter](src/http/index.ts) and [shared plugin](../../packages/core/src/openapi/plugin.ts). Offline OpenAPI generation is unsupported; the [documentation site](../docs/src/lib/openapi.ts) consumes only Ingestor and Asset artifacts.
