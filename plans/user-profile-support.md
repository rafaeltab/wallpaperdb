# User Profile Support

## Problem

WallpaperDB authenticates Users through Clerk and records Clerk user IDs on uploaded wallpapers, but it has no WallpaperDB-owned public identity. The web app therefore exposes raw user IDs, cannot link wallpapers to useful Profile pages, and cannot search or filter by community identity.

Issue #39 introduces Profiles as part of the User service domain. It is an umbrella story that may be split into independently deliverable slices before implementation.

## Domain Language

- A **User** is the authenticated principal managed by Clerk.
- A **Profile** is WallpaperDB's public representation of a User.
- A **Profile ID** is the immutable Clerk user ID and matches the `userId` recorded on wallpapers.
- A **Handle** is the Profile's unique, changeable, human-readable URL identifier.
- A **Handle alias** is an active routing claim that redirects an earlier Handle to the Profile's current Handle.
- A **Display name** is a non-unique, free-form public name.
- A **Biography** is self-authored Markdown.
- A **Profile event** is an append-only record of an accepted Profile or Handle alias change. Current Profile state remains authoritative.

The canonical glossary is maintained in `CONTEXT.md`.

## Profile Model

A Profile has:

- a non-null immutable Profile ID;
- a non-null current Handle;
- a non-null Display name;
- Biography Markdown, empty by default;
- an optional immutable Profile picture asset ID;
- a monotonically increasing version for optimistic concurrency;
- creation and update timestamps.

The Profile ID is used directly for wallpaper ownership relationships. No internal-to-Clerk identity mapping is introduced.

## Lazy Creation

The web app explicitly calls an authenticated, idempotent User-service REST command to ensure the current User's Profile exists. Public GraphQL reads never create Profiles.

Creation requires a successful Clerk identity lookup. If Clerk is unavailable, the command returns a service-unavailable response and creates nothing.

The initial Display name is selected in this order:

1. Clerk display name, if Clerk provides one.
2. Clerk full name.
3. A generated, curated multi-word name such as `Ostentatious Picklejar`.

The initial Handle is always the slugified Display name. If it collides with an existing Handle or Handle alias, a short random suffix is added and allocation is retried atomically.

The Clerk Profile picture is imported asynchronously. Import failure does not block Profile creation; the UI uses a deterministic generated avatar until import succeeds.

After creation, WallpaperDB owns all Profile fields. Later Clerk updates do not overwrite them.

## Handle Rules

- Handles use lowercase ASCII letters, digits, and single hyphens.
- Separators are trimmed and collapsed during slugification.
- Default length is 1-30 characters after slugification; both bounds are configurable in the User service.
- Comparison and uniqueness are case-insensitive.
- Technical and trust-sensitive names such as `admin`, `support`, `security`, API names, and route names are reserved.
- Celebrity and brand names are not proactively reserved. Administrative transfers are deferred.
- A Profile may change its Handle once every seven days.
- The change interval is enforced by the User service.

Current Handles and aliases share one unique claim namespace in PostgreSQL. Each accepted claim receives a monotonically increasing claim generation so projected duplicate claims can be resolved deterministically.

## Handle Aliases

Changing a Handle makes the former current Handle an alias by default.

- The default retained-alias limit is three and is configurable in the User service.
- Users cannot invent arbitrary aliases.
- A User may reactivate one of the Profile's historical Handles while it remains in the 30-day Profile event window, provided the Handle is unclaimed and an alias slot is available.
- When a change exceeds the retained-alias limit, the oldest retained alias is scheduled to expire.
- Manually removing an alias also schedules it to expire.
- Scheduled aliases continue redirecting and participating in fuzzy search for 24 hours.
- Expiring aliases stop counting toward the retained-alias limit immediately.
- The User may explicitly expire a scheduled alias immediately after a clear confirmation.
- Once expired, the Handle is released and may be claimed by another Profile.
- Alias scheduling, eviction, Handle changes, and related events are atomic.

Administrative transfer remains out of scope. The model permits future transfer because active alias claims are independent of historical Profile events.

## Biography

- Biography stores authored Markdown only; generated HTML is not authoritative or persisted.
- Default maximum length is 5,000 Unicode characters and is configurable in the User service.
- Raw HTML is rejected.
- The supported Markdown subset permits external links but rejects unsafe URL schemes and URLs containing credentials.
- Production external links require HTTPS.
- A shared Profile Markdown policy owns parsing and validation rules so the User service and web renderer cannot drift.
- The web uses `react-markdown` with `remark-gfm` to render Markdown directly into React elements rather than persisting or injecting an HTML string.
- Raw HTML remains disabled and `rehype-sanitize` sanitizes the rendered tree as defense in depth.
- External links show their normalized destination hostname and an external-link indicator.
- External links pass through a WallpaperDB warning interstitial before navigation.
- External links use `nofollow ugc noopener noreferrer`.
- Arbitrary external images are rejected.
- Biography images use standard Markdown image syntax with a WallpaperDB-specific target: `![Alt text](wallpaper:<wallpaper-id>)`.
- A shared remark plugin recognizes `wallpaper:` targets; the User service validates ownership and the web renders them through a dedicated Wallpaper component.
- Biography images may reference only published wallpapers owned by the same Profile; ordinary image URLs and other custom schemes are rejected.

The User service consumes wallpaper lifecycle events into a minimal `wallpaperId -> profileId` ownership projection and validates Biography image references locally. Projection lag may briefly prevent embedding a newly uploaded wallpaper.

Fuzzy Profile search does not search Biography content.

## Profile Pictures

The User service owns Profile picture ingestion and Profile changes. The media service owns public media delivery, matching the existing ingestor/media boundary.

- Accept JPEG, PNG, and WebP inputs.
- Reject SVG and animated formats.
- Default maximum upload size is 5 MB and is configurable.
- Pixel/decompression limits are configurable.
- Decode and re-encode accepted images to strip metadata and malformed content.
- Assign every imported or uploaded picture an immutable asset ID.
- Serve pictures through immutable media URLs such as `/media/profile-pictures/:pictureId`.
- Changing a picture changes the asset ID and URL, preserving immutable CDN/browser caching.
- Removing a picture uses a deterministic generated avatar and never restores Clerk ownership.
- Replaced or removed assets stop being publicly available immediately, remain privately available for abuse review for 30 days, and are then deleted.

The User service writes the object and Profile state safely, records the Profile event, and publishes the asset metadata required for the media service to serve the current picture.

## Profile Events And Delivery

Every accepted Profile or Handle alias transition:

1. Updates authoritative current state in PostgreSQL.
2. Appends a typed Profile event in the same transaction.
3. Records relevant before/after values for abuse review.
4. Includes the complete post-change public Profile snapshot, Profile version, stable event ID, and timestamp for projection.

The Profile event table is also a transactional outbox. An asynchronous publisher retries unpublished events to NATS. Gateway consumers apply events idempotently by Profile version. No email or other Clerk-private data is published.

User-service Profile events and private replaced pictures have a rolling 30-day retention period. Administrative event-review tooling is deferred because WallpaperDB does not yet have an administrator authorization model.

NATS events remain retained indefinitely for projection rebuilds as a temporary cross-application policy. Issue #162 reviews the GDPR implications and alternative rebuild strategies. This story does not claim to solve GDPR erasure.

## REST Command Interface

The web app sends authenticated commands directly to the User service. The User service verifies the Clerk JWT and derives the Profile ID from it.

The command-oriented interface includes:

- `POST /profile/me/ensure` to idempotently create or return the Profile;
- `PATCH /profile/me` to update Display name and Biography;
- `PUT /profile/me/picture` to upload a picture;
- `DELETE /profile/me/picture` to return to the generated fallback;
- `PUT /profile/me/handle` to change the Handle;
- `PUT /profile/me/aliases/:handle` to reactivate an eligible historical Handle;
- `DELETE /profile/me/aliases/:handle` to schedule alias expiry;
- an explicit immediate-expiry operation after user confirmation.

Every modifying command requires the caller's last-seen Profile version. Stale commands return `409 Conflict` rather than silently overwriting newer changes.

Successful commands return the authoritative updated Profile and version. The web updates its local state immediately while the GraphQL projection catches up asynchronously.

## GraphQL Read Interface

The gateway exposes the public, eventually consistent Profile read model through GraphQL.

Required capabilities:

- get a Profile by Profile ID;
- get a Profile by current Handle or active Handle alias;
- report whether a requested Handle was an alias and return the canonical current Handle;
- fuzzy-search Profiles by current Handle, active aliases, and Display name;
- get paginated wallpapers by Profile ID;
- get paginated wallpapers through a Profile relationship;
- filter wallpapers using a Profile selected by ID;
- include nullable Profile information on wallpaper results without duplicating Profile fields into wallpaper documents.

Representative schema shape:

```graphql
type Profile {
  id: ID!
  handle: String!
  displayName: String!
  biographyMarkdown: String!
  picture: ProfilePicture
  canonicalPath: String!
  wallpapers(first: Int, after: String, orderBy: WallpaperOrder): WallpaperConnection!
}

type ProfilePicture {
  id: ID!
  url: String!
}

type HandleResolution {
  profile: Profile!
  requestedHandle: String!
  isAlias: Boolean!
  canonicalHandle: String!
}

type Wallpaper {
  profileId: ID!
  profile: Profile
}

type Query {
  profile(id: ID!): Profile
  profileByHandle(handle: String!): HandleResolution
  searchProfiles(query: String!, first: Int, after: String): ProfileConnection!
}
```

The persisted and event-layer wallpaper field may remain `userId`; the public GraphQL interface uses `profileId` because it references the public Profile concept.

`Wallpaper.profile` is nullable because legacy/demo wallpapers, projection lag, or future deletion may leave an ownership ID without a resolvable Profile. `Wallpaper.profileId` remains non-null.

GraphQL does not enumerate a Profile's alias list publicly. Exact lookup and fuzzy search may use aliases, and Handle resolution reports whether the requested Handle was an alias. The owner receives alias details through authenticated REST.

## Search And OpenSearch

The gateway maintains one `profiles` OpenSearch index with one document per Profile. The document contains the current public snapshot and embedded active/expiring Handle aliases with claim generations.

PostgreSQL is the Handle uniqueness authority. If projection lag temporarily produces duplicate Handle claims, exact lookup selects the match with the highest claim generation.

Fuzzy Profile search ranks matches in this order:

1. Exact current Handle.
2. Current Handle prefix.
3. Exact active alias.
4. Active alias prefix.
5. Display name phrase or prefix.
6. Fuzzy Display name.

Current Handles outrank aliases. Aliases scheduled to expire remain searchable until they expire. Cursor pagination uses a stable Profile ID tiebreaker.

The existing `wallpapers` index retains only the non-null ownership ID. Profile fields are not denormalized into every wallpaper document.

The gateway batch-loads Profile documents for wallpaper result sets, avoiding N+1 queries. Fuzzy wallpaper search by Handle or Display name is deferred. The web provides a fuzzy Profile picker, then submits the selected Profile ID as an exact wallpaper filter.

Profile projections are rebuilt by replaying indefinitely retained NATS events for now. Issue #162 may replace that strategy.

## Public Web Experience

The canonical Profile URL is `/profiles/@:handle`. The `@` is presentation syntax and is not stored in the Handle.

- `/profiles/:handle` redirects to the canonical `@` form.
- Active and expiring Handle aliases redirect to the current canonical Handle.
- `/profiles/id/:profileId` performs immutable lookup and redirects to the canonical Handle URL.
- Unknown Profile IDs and Handles return 404.
- Generated links always use the canonical Handle URL.

Required web surfaces across the umbrella story:

- a public Profile page with picture, Display name, Handle, rendered Biography, and paginated wallpapers;
- authenticated Profile settings for Display name, Handle, Biography, picture, retained aliases, scheduled expiry, and immediate expiry confirmation;
- the existing Header Profile item linked to the current Profile/settings flow;
- a fuzzy Profile picker for wallpaper filtering;
- a wallpaper-detail author card replacing the raw User ID sidebar field.

The author card shows Profile picture, Display name, Handle, and a canonical Profile link. If `Wallpaper.profile` is null, it shows an `Unknown Profile` fallback with a generated avatar and the non-null Profile ID as secondary text, without a broken link.

## Testing Expectations

Tests should cover externally visible behavior at the narrowest useful layer:

- lazy Profile creation and Clerk failure handling;
- deterministic field derivation and random collision suffixing;
- Handle normalization, reserved names, uniqueness, claim generations, cooldown, and concurrent claims;
- alias limits, automatic eviction, scheduled expiry, immediate expiry, reactivation, and release;
- optimistic concurrency conflicts;
- Biography limits, Markdown validation, external-link transformation, and own-Wallpaper image validation;
- shared Markdown-policy parity, sanitized React rendering, and `wallpaper:` embed rendering;
- picture validation, immutable asset IDs, Clerk import retry, public retirement, private retention, and media delivery;
- transactional state/event writes and outbox retries;
- idempotent, version-aware gateway projection;
- exact Profile/Handle/alias GraphQL reads;
- fuzzy search ranking and cursor stability;
- batched nullable `Wallpaper.profile` resolution;
- canonical web redirects and missing-Profile fallbacks;
- Profile editing UI and wallpaper author/filter surfaces.

## Out Of Scope

- GDPR erasure and cross-system deletion, pending research and #162;
- Profile-only deletion or deactivation;
- administrator identity, authorization, moderation UI, and event-review API;
- administrative Handle or alias transfer;
- proactive celebrity or brand reservations;
- Biography full-text search;
- fuzzy wallpaper search by Profile attributes;
- external Biography images or dedicated Biography attachments;
- continuously synchronizing WallpaperDB Profile fields from Clerk.

## Delivery Slices

This umbrella story should be split before implementation. Likely independently assignable slices include:

1. User-service Profile schema, lazy creation, REST commands, optimistic concurrency, and tests.
2. Handle claims, aliases, cooldown/expiry, and tests.
3. Profile event log, transactional outbox, shared event contracts, and retention worker.
4. Gateway Profile projection, OpenSearch mapping, GraphQL reads/search, and nullable wallpaper relationship.
5. Profile picture ingestion, events, media-service catalog/delivery, and retention.
6. Biography validation, own-Wallpaper ownership projection, and external-link interstitial contract.
7. Public Profile routes/page and canonical redirects.
8. Profile settings and alias-management UI.
9. Wallpaper Profile picker and wallpaper-detail author card.

## Context

- #7 establishes Clerk authentication as the parent capability.
- #38 adds Clerk authentication and authenticated API headers to the web app.
- #41 verifies Clerk JWTs for backend uploads and establishes Clerk user IDs as wallpaper ownership IDs.
- #37 scaffolds the User service that will own Profiles.
- #162 reviews indefinite event retention, projection rebuilding, GDPR deletion, and backups across WallpaperDB.
- `docs/adr/0001-use-clerk-user-ids-as-profile-ids.md` records the Profile identity decision.
- `docs/adr/0002-project-profiles-into-the-graphql-read-model.md` records the command/read-model boundary.
