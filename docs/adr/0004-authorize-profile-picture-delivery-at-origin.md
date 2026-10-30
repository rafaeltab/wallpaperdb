# Authorize Profile picture delivery against User state

Superseded for the target architecture by [ADR 0011](0011-unlink-profile-pictures-before-asynchronous-media-deletion.md) and [ADR 0012](0012-own-stable-assets-and-immutable-sources-in-media.md). They replace the immediate origin-denial guarantee and synchronous User callback with asynchronous unlink/deletion and Media-owned lifecycle and retention. Cache policy is unchanged. The historical decision follows.

User owns immutable Profile picture assets in private object storage and publishes their delivery metadata to Media. Media checks the asset's current public availability with User on every origin request, using an authenticated internal endpoint and failing closed; an asynchronous projection alone cannot stop delivery immediately after replacement or removal.

## Consequences

Picture delivery depends on User availability and adds an uncached authority request. Successful responses retain immutable browser/CDN caching, so removal stops subsequent origin delivery but cannot recall already downloaded or cached copies. Error responses are not cached, allowing a newly accepted picture to become available as its Media projection catches up. Retired objects remain private evidence until the retention worker deletes them after their configured window (30 days by default). Their recorded expiry is preserved when configuration changes.
