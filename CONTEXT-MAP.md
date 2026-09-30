# Context Map

## Contexts

- [User](./apps/user/CONTEXT.md) - owns Profiles and their community-facing identity
- [Gateway Catalogue](./apps/gateway/CONTEXT.md) - owns public wallpaper discovery and its interpretations of contributor Profiles
- [Wallpaper Ingestion](./apps/ingestor/CONTEXT.md) - owns upload acceptance, immutable originals, and durable upload announcements

Additional contexts are documented lazily as their domain language is resolved.

- [Wallpaper color extraction](./apps/color-extractor/CONTEXT.md) - owns measurements of an original wallpaper's color distribution

- [Wallpaper variant generation](./apps/variant-generator/CONTEXT.md) - owns lower-resolution wallpaper variants

- [Media delivery](./apps/media/CONTEXT.md) - owns the delivery catalog and serves immutable assets

- [Tagging](./apps/tags/CONTEXT.md) - reserved for wallpaper classification; domain language remains undefined

## Relationships

- **User -> Gateway**: User publishes Profile events; Gateway projects public Profile reads and search into GraphQL.
- **User -> Media**: User ingests Profile pictures; Media makes immutable Profile picture assets publicly available.
- **Media -> User**: Media checks current public picture availability before serving an origin request; [the delivery decision](./docs/adr/0004-authorize-profile-picture-delivery-at-origin.md) describes the availability and caching trade-off.
- **Ingestor -> User**: Wallpaper ownership records use the Profile ID, which is the authenticated Clerk user ID. User consumes published wallpaper events into a minimal ownership projection to validate Biography embeds.
- **User -> Web**: User accepts authenticated Profile commands; Web presents and edits Profiles.
- **User <-> Web**: A [shared Markdown policy](./docs/adr/0005-share-the-profile-markdown-policy.md) keeps Biography acceptance and React rendering aligned.

- **Ingestor -> Color Extractor**: Uploaded wallpaper events identify immutable originals for color extraction.
- **Color Extractor -> Gateway**: Published color measurements support color-ranked discovery. The current contract carries histograms; [ADR 0006](./docs/adr/0006-use-precomputed-color-utilities-with-three-quality-levels.md#production-integration-decisions) accepts versioned matching-area and quality measurements, from which the Catalogue derives target utilities. The replacement is tracked in [#305](https://github.com/rafaeltab/wallpaperdb/issues/305) and [#306](https://github.com/rafaeltab/wallpaperdb/issues/306).

- **Ingestor -> Variant Generator**: Uploaded wallpaper events identify originals for variant generation.
- **Variant Generator -> Media**: Stored variant announcements supply renditions for delivery.
