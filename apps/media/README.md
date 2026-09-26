# Media

Media delivers wallpapers, resized renditions, and current Profile pictures from private object storage. Its delivery catalog follows facts published by the services that own those assets.

User remains the authority for Profile picture availability. Origin checks cannot recall immutable copies already cached by clients.

Read the [domain context](CONTEXT.md), [delivery decision](docs/adr/0001-replay-safe-delivery-catalog.md), and [upgrade and recovery procedures](../docs/content/docs/guides/service-upgrades.mdx) before changing delivery or replaying events.
