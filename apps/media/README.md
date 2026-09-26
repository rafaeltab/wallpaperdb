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

Read the [domain context](CONTEXT.md), [delivery decision](docs/adr/0001-replay-safe-delivery-catalog.md), and [upgrade and recovery procedures](../docs/content/docs/guides/service-upgrades.mdx) before changing delivery or replaying events.
