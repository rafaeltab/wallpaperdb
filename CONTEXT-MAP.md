# Context Map

## Contexts

- [User](./apps/user/CONTEXT.md) - owns Profiles and their community-facing identity

Additional contexts are documented lazily as their domain language is resolved.

## Relationships

- **User -> Gateway**: User publishes Profile events; Gateway projects public Profile reads and search into GraphQL.
- **User -> Media**: User ingests Profile pictures; Media makes immutable Profile picture assets publicly available.
- **Ingestor -> User**: Wallpaper ownership records use the Profile ID, which is the authenticated Clerk user ID.
- **User -> Web**: User accepts authenticated Profile commands; Web presents and edits Profiles.
