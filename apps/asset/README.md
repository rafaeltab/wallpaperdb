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

## Owned Source operations

The [author routes](src/http/sources.ts) and [generated OpenAPI](swagger.json) define the Owner interface. The [authority parser](src/authority.ts) owns strict file configuration; [initial policies](src/capabilities/sources/policy.ts) distinguish author admission from native processing capacity. Candidate expiry is operator configuration, separate from analysis or application attachment lifetimes.

Run the existing [development configuration setup](scripts/development-authority.ts) after updating this branch. It preserves credentials while replacing former empty type entries. A policy edit changes the effective configuration identity. Use the [operator's controlled activation](scripts/operator.ts) before restarting with that file; bootstrap never replaces an existing active revision. Admission edits apply to future acceptance and do not withdraw accepted Sources.

Committed `asset.source.accepted` events share each Creating application's protected results channel with command results. Consumers distinguish event type and correlate logical Asset/candidate identities with their own durable intent. Source confirmations retry with a stable occurrence identity and a finite leased outbox budget. The operator's `recover-source-confirmation` command deliberately retries exhausted responsibility; reading candidate status does not reset that budget.

Mandatory inspection runs strict native decoding in a child process and verifies animated picture frames individually. Cancellation and shutdown kill and reap that work. This first-Source implementation does not qualify HDR processing or claim deployment capacity. The shared foreground/background limiter and measured operational profiles belong to [materialization #457](https://github.com/rafaeltab/wallpaperdb/issues/457); its composition can replace the [mandatory inspection port](src/capabilities/sources/contract.ts). Candidate and reserved orphan identities carry recorded cleanup deadlines from creation.

## Terminal owned-Asset deletion

Only the protected Creating-application command channel can authorize full deletion. Owner Source operations do not grant that authority. The [lifecycle port](src/capabilities/lifecycle/contract.ts) records the command result, terminal fence, empty-capability responsibility and cleanup obligation atomically. New Source operations and original reads become unavailable at acceptance even while private evidence bytes remain. Reads already accepted retain their finite protected lifetime.

A replayed create returns its original result without restoring the Asset. Equal delete replay returns the recorded result, and a fresh delete command for the same terminal Asset returns `already-deleted`. Compact Asset and command fences remain after evidence expiry. Candidate identities and immutable Source metadata identify cleanup work independently of active membership. The deletion responsibility is local; this change does not define the future public delivery/discovery announcement contract.

New development authority files permit creation and deletion for the initial applications. Existing files retain their configured operation permissions. Enable deletion explicitly in the trusted file and follow the same controlled activation/restart procedure used for policy changes. Every lifecycle acceptance, including replay, compares the active configuration under its transaction lock. An obsolete worker cannot accept under an inactive revision; previously recorded outcomes remain stable when replayed by the active configuration. Credential rotation preserves the Creating application's identity. Removing a current permission does not rewrite a previously recorded command outcome.

## Private byte reclamation

The [cleanup capability](src/capabilities/cleanup/index.ts) reclaims expired evidence and abandoned or terminal candidate data through bounded durable work. Recorded evidence, candidate and temporary-input deadlines survive retries, configuration changes and restart. Accepted or cancelled inputs become reclaimable promptly; retired Source evidence keeps its original deadline. Current Sources are excluded under the same Asset lock used for membership changes.

An accepted original read reserves finite protection atomically with authorization and membership. The absolute deadline includes database authorization and storage opening. EOF, cancellation and failure release protection; a hung storage or HTTP stream ends at the configured bound. Expiry never grants serving authority. The [trusted authority parser](src/authority.ts) defines `sourceOperations.readLifetimeMs` and `reclamationTimeoutMs`, independently of retention and Color Extractor execution. These are configurable operational ceilings, not a production throughput or native-processing qualification.

The [storage adapter](src/adapters/sources/storage.ts) atomically replaces each reclaimed object's payload with an empty deletion marker at its exact private identity. The marker is never accepted image data. It prevents a late conditional immutable write from recreating bytes after cleanup; deleting the object first would leave that race open. Retain these compact markers for the installation's replay lifetime and exclude them from bucket lifecycle removal. Real storage contracts qualify the repository's SeaweedFS version, including a conditional request already consuming its body and an ambiguous reclamation response. Other storage implementations need the same contract qualification.

After a deleted Asset's cleanup completes, image metadata and candidate history are purged while compact Asset, command and cleanup fences remain. Exhausted cleanup is quarantined and routed to the configured operator inbox. Its notice subject contains `asset.cleanup.` followed by the exact responsibility ID. Pass that ID to the trusted operator's [`recover-cleanup` command](scripts/operator.ts). Recovery preserves the deadline and starts a new notice occurrence if another outage exhausts the work; retries of one occurrence keep its identity. No Owner HTTP route grants cleanup recovery or full deletion authority.
