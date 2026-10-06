# Context Map

## Contexts

- [User](./apps/user/GLOSSARY.md) - owns Profiles and their community-facing identity
- [Gateway Catalogue](./apps/gateway/GLOSSARY.md) - owns public wallpaper discovery and its interpretations of contributor Profiles
- [Wallpaper Ingestion](./apps/ingestor/GLOSSARY.md) - owns upload acceptance, immutable originals, and durable upload announcements

Additional contexts are documented lazily as their domain language is resolved.

- [Wallpaper color extraction](./apps/color-extractor/GLOSSARY.md) - owns measurements of an original wallpaper's color distribution

- [Wallpaper variant generation (legacy)](./apps/variant-generator/GLOSSARY.md) - currently produces lower-resolution wallpaper variants; the [accepted delivery plan](https://github.com/rafaeltab/wallpaperdb/issues/250) moves generation ownership to Media

- [Media](./apps/media/GLOSSARY.md) - currently owns on-request rendition processing, the delivery catalog, and delivery of immutable Assets. The [accepted target model](https://github.com/rafaeltab/wallpaperdb/issues/250) assigns Asset inspection and all rendition generation to Media, including migration of legacy variant generation. [ADR 0009](./docs/adr/0009-process-temporary-hdr-profile-picture-sources-in-media.md) adds temporary HDR Profile picture conversion to that target ownership.

- [Tagging](./apps/tags/GLOSSARY.md) - reserved for wallpaper classification; domain language remains undefined

## Relationships

- **User -> Gateway**: User publishes Profile events; Gateway projects public Profile reads and search into GraphQL.
- **User -> Media**: User ingests Profile pictures; Media makes immutable Profile picture assets publicly available.
- **Media -> User**: Media checks current public picture availability before serving an origin request; [the delivery decision](./docs/adr/0004-authorize-profile-picture-delivery-at-origin.md) describes the availability and caching trade-off.
- **Ingestor -> User**: Wallpaper ownership records use the Profile ID, which is the authenticated Clerk user ID. User consumes published wallpaper events into a minimal ownership projection to validate Biography embeds.
- **User -> Web**: User accepts authenticated Profile commands; Web presents and edits Profiles.
- **User <-> Web**: A [shared Markdown policy](./docs/adr/0005-share-the-profile-markdown-policy.md) keeps Biography acceptance and React rendering aligned.
- **Web <-> Media**: The planned HDR editing flow sends temporary sources and crop settings from Web to Media, which returns processed images for Web to upload to User. The [processing ownership decision](./docs/adr/0009-process-temporary-hdr-profile-picture-sources-in-media.md) records why Media owns this stateless conversion while User owns the accepted Asset.

- **Ingestor -> Color Extractor**: Uploaded wallpaper events identify immutable originals for color extraction.
- **Color Extractor -> Gateway**: Published matching-area and quality measurements provide the source for color-ranked discovery.

- **Ingestor -> Variant Generator**: Uploaded wallpaper events identify originals for variant generation.
- **Variant Generator -> Media**: Stored variant announcements supply renditions for delivery.
