# Media

Media delivers wallpapers, resized renditions, and current Profile pictures from private object storage. Its delivery catalog follows facts published by the services that own those assets.

## Core capabilities

- Deliver original wallpapers and resize them to requested dimensions with contain, cover, or fill behavior.
- Choose a suitable pre-generated variant for a resize and fall back to the original when the variant object is missing.
- Serve current Profile pictures only after checking with User that the picture remains publicly available.
- Keep the delivery catalog consistent when events are repeated or arrive out of order, and announce available wallpaper renditions for discovery.
- Make successful asset responses cacheable as immutable content. Origin checks cannot recall Profile pictures already cached by clients.

## Technology choices

PostgreSQL commits delivery catalog changes together with their pending availability announcements so they can recover after interrupted publication. Sharp performs resizing in isolated worker processes so cancelled requests can stop native image work.

Read the [domain context](GLOSSARY.md), [delivery decision](docs/adr/0001-replay-safe-delivery-catalog.md), and [upgrade and recovery procedures](../docs/content/docs/guides/service-upgrades.mdx) before changing delivery or replaying events.

## Testing

The [unit selection](vitest.config.ts) runs Delivery and availability capabilities with controlled adapters, HTTP contracts with controlled ports, and event translation. The integration selection retains storage and broker contracts, native image processing, application health, artifact builds, and telemetry. Select by these dependencies rather than filenames; `health.test.ts` boots the application with infrastructure.

The [workspace scripts](package.json) expose both selections with coverage and retain `test` for the complete suite. Run them through the [Make workspace selectors](../../Makefile). The [root coverage script](../../package.json) combines `coverage/unit` and `coverage/integration` for CI.
