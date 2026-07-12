# WallpaperDB

WallpaperDB is a community catalog of wallpapers and the people who contribute them.

## Language

**User**:
The authenticated principal whose identity is managed by Clerk.
_Avoid_: Profile, contributor

**Profile**:
The public WallpaperDB representation of a User, containing their community-facing identity and presentation.
_Avoid_: User, account

**Profile ID**:
The immutable Clerk user ID that identifies a Profile and matches the `userId` recorded on its wallpapers.
_Avoid_: Internal user ID, Clerk ID mapping

**Handle**:
A unique, changeable identifier for a Profile that provides its human-readable URL slug.
_Avoid_: Username, display name

**Handle alias**:
An active routing claim that redirects an earlier Handle to a Profile's current Handle. It may be removed or administratively transferred independently of the Profile's history.
_Avoid_: Previous handle, handle history

**Display name**:
A Profile's non-unique, free-form public name.
_Avoid_: Handle, username

**Biography**:
A Profile's self-authored, freely editable Markdown description.
_Avoid_: Description, bio

**Profile event**:
An append-only record of an accepted change to a Profile or its Handle aliases. Profile events explain recent state changes but are not the source of current Profile state.
_Avoid_: Event-sourced Profile, permanent history
