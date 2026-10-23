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

Read the [domain context](GLOSSARY.md), [delivery decision](docs/adr/0001-replay-safe-delivery-catalog.md), and [upgrade and recovery procedures](../docs/content/docs/guides/service-upgrades.mdx#rename-from-media) before changing delivery or replaying events. The upgrade guide inventories the persistent Media identifiers retained to preserve data and messaging progress.

## Owned Source operations

The [author routes](src/http/sources.ts) and [generated OpenAPI](swagger.json) define the Owner interface. The [authority parser](src/authority.ts) owns strict file configuration; [initial policies](src/capabilities/sources/policy.ts) distinguish author admission from native processing capacity. Candidate expiry is operator configuration, separate from analysis or application attachment lifetimes.

Run the existing [development configuration setup](scripts/development-authority.ts) after updating this branch. It preserves credentials while replacing former empty type entries. A policy edit changes the effective configuration identity. Use the [operator's controlled activation](scripts/operator.ts) before restarting with that file; bootstrap never replaces an existing active revision. Admission edits apply to future acceptance and do not withdraw accepted Sources.

Committed `asset.source.accepted` events share each Creating application's protected results channel with command results. Consumers distinguish event type and correlate logical Asset/candidate identities with their own durable intent. Source confirmations retry with a stable occurrence identity and a finite leased outbox budget. The operator's `recover-source-confirmation` command deliberately retries exhausted responsibility; reading candidate status does not reset that budget.

Mandatory inspection runs strict native decoding in a child process and verifies animated picture frames individually. Cancellation and shutdown kill and reap that work. This first-Source implementation does not qualify HDR processing or claim deployment capacity. The shared foreground/background limiter and measured operational profiles belong to [materialization #457](https://github.com/rafaeltab/wallpaperdb/issues/457); its composition can replace the [mandatory inspection port](src/capabilities/sources/contract.ts). Candidate and reserved orphan identities carry recorded cleanup deadlines from creation; asynchronous cleanup belongs to [#473](https://github.com/rafaeltab/wallpaperdb/issues/473).
