# Context Map

## Contexts

- [User](./apps/user/GLOSSARY.md) - owns Profiles and their community-facing identity
- [Gateway Catalogue](./apps/gateway/GLOSSARY.md) - owns public wallpaper discovery and its interpretations of contributor Profiles
- [Wallpaper Ingestion](./apps/ingestor/GLOSSARY.md) - currently owns byte ingestion; the target retains Wallpaper identity/publication workflow while Media owns Source admission and bytes

Additional contexts are documented lazily as their domain language is resolved.

- [Wallpaper color extraction](./apps/color-extractor/GLOSSARY.md) - owns stable measurements of the first Default Source's color distribution

- [Wallpaper variant generation (legacy)](./apps/variant-generator/GLOSSARY.md) - currently produces lower-resolution wallpaper variants; the [accepted delivery plan](https://github.com/rafaeltab/wallpaperdb/issues/250) moves generation ownership to Media

- [Media](./apps/media/GLOSSARY.md) - the accepted target owns the complete lifecycle of stable Assets and immutable Sources, with generic policies selected by Asset type. [ADR 0010](./docs/adr/0010-authenticate-media-owners-through-configured-identity-providers.md), [ADR 0011](./docs/adr/0011-unlink-profile-pictures-before-asynchronous-media-deletion.md) and [ADR 0012](./docs/adr/0012-own-stable-assets-and-immutable-sources-in-media.md) explicitly replace the older ownership/identity/availability/transfer clauses while retaining product and reliability requirements. The implementation remains on the older architecture until the planned clean rebuild.

- [Tagging](./apps/tags/GLOSSARY.md) - reserved for wallpaper classification; domain language remains undefined

## Existing implementation relationships

- **User -> Gateway**: User publishes Profile events; Gateway projects public Profile reads and search into GraphQL.
- **User -> Media**: User ingests Profile pictures; Media makes immutable Profile picture assets publicly available.
- **Media -> User**: The existing implementation checks current public picture availability before serving an origin request. [ADR 0011](./docs/adr/0011-unlink-profile-pictures-before-asynchronous-media-deletion.md) replaces that callback and its immediate origin-denial guarantee in the target architecture.
- **Ingestor -> User**: Wallpaper ownership records use the Profile ID, which is the authenticated Clerk user ID. User consumes published wallpaper events into a minimal ownership projection to validate Biography embeds.
- **User -> Web**: User accepts authenticated Profile commands; Web presents and edits Profiles.
- **User <-> Web**: A [shared Markdown policy](./docs/adr/0005-share-the-profile-markdown-policy.md) keeps Biography acceptance and React rendering aligned.
- **Web <-> Media**: The earlier HDR editing plan returned processed output through Web for upload into User. [ADR 0012](./docs/adr/0012-own-stable-assets-and-immutable-sources-in-media.md) replaces that transfer with Media retention of the accepted processed crop, preserving the [Profile picture product policy](https://github.com/rafaeltab/wallpaperdb/issues/270#issuecomment-5902621514).

- **Ingestor -> Color Extractor**: Uploaded wallpaper events identify immutable originals for color extraction.
- **Color Extractor -> Gateway**: Published matching-area and quality measurements provide the source for color-ranked discovery.

- **Ingestor -> Variant Generator**: Uploaded wallpaper events identify originals for variant generation.
- **Variant Generator -> Media**: Stored variant announcements supply renditions for delivery.

## Accepted target relationships

- **Domain applications -> Media**: Applications send durable creation/deletion commands in Media's language over NATS, using separate credentials and exclusive broker-enforced publish permissions. Media maps the protected channel to application authority, assigns the Asset ID and echoes the opaque Application reference; the Creating application may authorize full deletion. Trusted configuration selects permitted operations, types and Owner namespaces. The [authentication decision](./docs/adr/0010-authenticate-media-owners-through-configured-identity-providers.md) keeps this authority distinct from author identity.
- **User -> Media**: User unlinks a removed Profile picture and durably requests deletion without waiting for Media. Media owns terminal Asset deletion and local delivery availability; generated avatars require no Asset. [ADR 0011](./docs/adr/0011-unlink-profile-pictures-before-asynchronous-media-deletion.md) records the accepted interval in which an already-known URL may still work.
- **Web -> Media**: Web selects the Profile picture crop. Media processes temporary HDR input and retains only the validated cropped output as an accepted Source; the SDR browser-editor path submits its processed crop for Media acceptance. User retains the Profile reference and workflow. [ADR 0012](./docs/adr/0012-own-stable-assets-and-immutable-sources-in-media.md) replaces the old byte-ownership and transfer contracts.
- **Creators -> Media**: Media directly verifies the configured identity provider's credentials and maps the authenticated subject into an Owner namespace. Matching Asset owners upload, add, replace, and withdraw immutable Source renditions under the configured Source acceptance policy.
- **Media -> Gateway**: Compact revisioned Faithful Delivery capabilities establish availability and output characteristics, including qualified conversions, with Native coverage valid for those outputs. [The resolution](https://github.com/rafaeltab/wallpaperdb/issues/391#issuecomment-6313111831) preserves native browse size/shape requirements and replaces categorical source-only filtering. Gateway interprets Media facts without deriving codec support or relying on stored inventory. Final event schema, sizing and validation remain #259 work.
- **Wallpaper -> Color Extractor**: Media-established first-Default Source identity supplies the stable analysis reference. Recorded measurements retain Asset/Source/analysis provenance across later default changes, replacements and withdrawals; ordinary Source-byte retention remains separate. The [color algorithm](./docs/adr/0006-use-precomputed-color-utilities-with-three-quality-levels.md) is unchanged. Purpose-specific input access and final contracts belong to #259, without exposing Source inventory in the public capability announcement.
