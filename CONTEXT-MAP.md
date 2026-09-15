# Context Map

## Contexts

- [User](./apps/user/CONTEXT.md) - owns Profiles and their community-facing identity
- [Gateway Catalogue](./apps/gateway/CONTEXT.md) - owns public wallpaper discovery and its interpretations of contributor Profiles

Additional contexts are documented lazily as their domain language is resolved.

## Relationships

- **User -> Gateway**: User publishes Profile events; Gateway projects public Profile reads and search into GraphQL.
- **User -> Media**: User ingests Profile pictures; Media makes immutable Profile picture assets publicly available.
- **Media -> User**: Media checks current public picture availability before serving an origin request; [the delivery decision](./docs/adr/0004-authorize-profile-picture-delivery-at-origin.md) describes the availability and caching trade-off.
- **Ingestor -> User**: Wallpaper ownership records use the Profile ID, which is the authenticated Clerk user ID. User consumes published wallpaper events into a minimal ownership projection to validate Biography embeds.
- **User -> Web**: User accepts authenticated Profile commands; Web presents and edits Profiles.
- **User <-> Web**: A [shared Markdown policy](./docs/adr/0005-share-the-profile-markdown-policy.md) keeps Biography acceptance and React rendering aligned.
