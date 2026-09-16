# Gateway

The public discovery layer for WallpaperDB. It lets visitors browse wallpapers and contributor Profiles using a catalogue built from facts published by their owning services.

## Key capabilities

- Search wallpapers by contributor, rendition dimensions and format, with color preference ranking and bidirectional pagination.
- Retrieve wallpapers and public Profiles, batch contributor lookups, and present media URLs.
- Keep the catalogue up to date through replay-safe projection updates and durable handling of failed deliveries.
- Bound query depth, breadth, complexity, batching and visitor request rates.
- Report availability and trace requests through catalogue reads and projection updates.

## Technology

- **Effect 4** provides typed services and layers, execution, technical errors, clocks, tracing, and scoped connection and task lifetimes.
- **Mercurius** provides GraphQL over Fastify.
- **OpenSearch** serves the catalogue and nested rendition search.
- **Redis** coordinates request quotas. Outages allow requests, report lost enforcement, and reconnect automatically.
- **NATS JetStream** retains incoming facts and quarantined deliveries.
