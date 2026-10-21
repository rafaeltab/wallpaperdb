# Authorize Profile picture delivery against User state

Status: superseded for the target Media architecture by [ADR 0011](0011-unlink-profile-pictures-before-asynchronous-media-deletion.md) and [ADR 0012](0012-own-stable-assets-and-immutable-sources-in-media.md). Profile unlink succeeds before asynchronous Media deletion; an already-known URL may remain usable until Media processes deletion. Media owns local availability and source storage, replacing the immediate origin-denial guarantee and synchronous User callback below. Media also takes responsibility for private evidence under per-Asset-type retention configuration, preserving the 30-day Profile picture default and recorded expiry. No new cache policy is selected. The text below records the existing implementation and its historical rationale.

User owns immutable Profile picture assets in private object storage and publishes their delivery metadata to Media. Media checks the asset's current public availability with User on every origin request, using an authenticated internal endpoint and failing closed; an asynchronous projection alone cannot stop delivery immediately after replacement or removal.

## Consequences

Picture delivery depends on User availability and adds an uncached authority request. Successful responses retain immutable browser/CDN caching, so removal stops subsequent origin delivery but cannot recall already downloaded or cached copies. Error responses are not cached, allowing a newly accepted picture to become available as its Media projection catches up. Retired objects remain private evidence until the retention worker deletes them after their configured window (30 days by default). Their recorded expiry is preserved when configuration changes.
