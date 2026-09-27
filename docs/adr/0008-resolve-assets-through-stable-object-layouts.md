# Resolve assets through stable object layouts

Status: accepted. Supersedes [ADR 0007](0007-resolve-immutable-assets-through-storage-descriptors.md).

WallpaperDB has no production installation and its producers already store immutable images at predictable paths. Keep logical asset references in events, and let storage adapters derive addresses from those references, public event metadata, and deployment configuration. Remove the per-asset descriptor registry because its extra writes, permissions, health checks, backup requirements, and failure modes do not solve a current requirement.

## Decision and consequences

The shared storage adapter module owns one stable layout for each producer. Originals use the wallpaper ID and detected image format. Variants use the wallpaper ID, nominal resolution preset, and format encoded in their logical identity. The preset remains stable when encoded dimensions differ through aspect-ratio rounding. Profile pictures use the Profile ID from the snapshot and immutable picture ID. Events continue to carry public image facts without bucket names or object keys.

All original consumers use the same configured wallpaper bucket. User and Media agree on the configured Profile-picture bucket. These settings and layouts are part of the retained asset contract, not freely changeable deployment preferences. Producers reject a recorded private location that cannot be represented by the logical reference instead of announcing a different object. Existing coordinate-based events retain their exact locations. Variant generation replaying a coordinate-based original retains the supported coordinate-based announcement so an earlier bucket cannot be silently reinterpreted.

Only the owning producer may delete bytes. Changed content receives a new identity, and retired identities are never reused. User still controls whether Media may serve a Profile picture, independently of the storage layout. Media persists resolved addresses in its delivery catalog; changing configuration does not rewrite existing catalog entries.

A bucket or layout change requires an explicit migration covering objects, producer records, Media's catalog, and retained events or outbox work. Preserve logical identities and prove replay before switching configuration. If old and new layouts must coexist, introduce an explicit layout version and support both for their retention horizon. Do not infer layout versions from deployment dates or repoint existing identities to different bytes.

This replaces indirection with a deliberate dependency on a shared stable layout. Revisit the decision only when a concrete requirement, such as concurrent storage providers or arbitrary historical locations, cannot be handled by a bounded migration. Record that evidence in a superseding ADR before introducing another registry. Production upgrade, recovery, and Grafana notification rehearsals remain tracked in [issue 236](https://github.com/rafaeltab/wallpaperdb/issues/236).
