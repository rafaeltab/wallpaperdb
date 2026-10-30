# Asset

Asset owns stable Assets and their immutable Sources. Applications create empty owned Assets through protected durable commands. Authenticated Owners discover admission policy, prepare private candidates, accept the first Source and read its exact original bytes. The existing wallpaper and Profile picture delivery catalog remains alongside this lifecycle while its integrations are rebuilt.

## Core capabilities

- Keep Source admission separate from accepted membership. First acceptance atomically records Default, Source-set and delivery revisions, stable initial analysis provenance and the Creating application's logical confirmation outbox.
- Preserve encoded originals and verified mandatory geometry/format facts. Initial wallpaper admission is still SDR JPEG/PNG/WebP; canonical SDR pictures are square WebP, including verified animation. HDR models remain disabled until their exact paths qualify.

- Deliver original wallpapers and resize them to requested dimensions with contain, cover, or fill behavior.
- Choose a suitable pre-generated variant for a resize and fall back to the original when the variant object is missing.
- Serve current Profile pictures only after checking with User that the picture remains publicly available.
- Keep the delivery catalog consistent when events are repeated or arrive out of order, and announce available wallpaper renditions for discovery.
- Make successful asset responses cacheable as immutable content. Origin checks cannot recall Profile pictures already cached by clients.

## Technology choices

PostgreSQL commits delivery catalog changes together with their pending availability announcements so they can recover after interrupted publication. Sharp performs resizing in isolated worker processes so cancelled requests can stop native image work.

Read the [domain context](GLOSSARY.md), [delivery decision](docs/adr/0001-replay-safe-delivery-catalog.md) and [storage ownership decision](../../docs/adr/0012-own-stable-assets-and-immutable-sources-in-media.md) before changing delivery or replaying events.

## Authority changes and recovery

The [author routes](src/http/sources.ts) define the Owner interface; the [authority parser](src/authority.ts) defines trusted configuration. Candidate expiry, evidence retention, and original-read lifetimes are separate policies.

The [development authority setup](scripts/development-authority.ts) preserves existing credentials and permissions. After changing a trusted policy file, use the [operator's controlled activation](scripts/operator.ts) before restarting. Bootstrap never replaces an active revision. Admission changes affect future acceptance without withdrawing accepted Sources. Enable deletion explicitly in existing development authority files when required.

Only the protected Creating-application channel authorizes full Asset deletion. Deletion disables new Source operations and original reads before physical cleanup finishes. Accepted reads retain their finite protection. Replayed commands preserve recorded outcomes; credential rotation must preserve the Creating application's identity.

Exhausted Source confirmations and cleanup require deliberate operator recovery. Candidate status reads do not reset retry budgets. Cleanup notices carry the exact responsibility ID for the operator's recovery command; no Owner route grants recovery authority. Consult the [operator entry point](scripts/operator.ts) for commands.

## Storage and processing limits

Mandatory inspection isolates native decoding in a child process and verifies animated picture frames individually. This does not qualify HDR processing or deployment capacity. The [materialization work](https://github.com/rafaeltab/wallpaperdb/issues/457) owns shared native-processing limits and measured profiles.

Cleanup replaces reclaimed private payloads with empty deletion markers. Retain these markers for the installation's replay lifetime and exclude them from bucket lifecycle removal: deleting an object outright would let a late conditional immutable write recreate its bytes. The [storage contracts](src/adapters/sources/storage.ts) qualify SeaweedFS behavior; another storage implementation needs equivalent qualification.
