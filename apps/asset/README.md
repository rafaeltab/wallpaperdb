# Asset

Asset owns stable Assets and their immutable Sources. Applications create empty owned Assets through protected durable commands; authenticated Owners prepare private candidates, accept the first Source and read its exact original bytes. Legacy wallpaper and Profile picture delivery remains alongside this lifecycle during the rebuild.

## Delivery

- Resize wallpapers with contain, cover or fill, selecting a suitable stored variant and falling back to the original if its object is missing.
- Check current Profile picture availability with User before origin delivery. Immutable client/CDN caches cannot be recalled.
- Accept repeated or out-of-order events without regressing the catalog and durably announce available wallpaper renditions.

PostgreSQL commits catalog changes with pending announcements. Sharp resizes in killable child processes. Read the [domain context](GLOSSARY.md), [delivery decision](docs/adr/0001-replay-safe-delivery-catalog.md) and [upgrade guide](../docs/content/docs/guides/service-upgrades.mdx#rename-from-media) before replaying events. The guide lists retained Media identifiers that preserve data and messaging progress.

## Owned Source operations

The [author routes](src/http/sources.ts) and [OpenAPI](swagger.json) define the Owner interface. The [authority parser](src/authority.ts) owns trusted file configuration; [admission policy](src/capabilities/sources/policy.ts) is separate from native processing capacity. Candidate expiry is independent of analysis and attachment lifetimes.

First acceptance atomically records Default, Source-set and delivery revisions, stable initial analysis provenance and the Creating application's confirmation outbox. It preserves encoded originals and verified mandatory facts. Wallpaper admission supports SDR JPEG/PNG/WebP; canonical SDR pictures are square WebP, including verified animation. HDR remains disabled until its exact processing paths qualify. Strict native inspection runs in a child process and verifies animated frames individually; cancellation and shutdown kill and reap it. Candidate and reserved orphan identities record cleanup deadlines at creation. Shared processing capacity and measured operational profiles belong to [#457](https://github.com/rafaeltab/wallpaperdb/issues/457), which can replace the [inspection port](src/capabilities/sources/contract.ts).

Run [development configuration setup](scripts/development-authority.ts) after updating this branch. It preserves credentials and replaces former empty type entries. Policy edits change the configuration identity and require [controlled activation](scripts/operator.ts) before restart; bootstrap never replaces an active revision. Admission changes affect future acceptance, not accepted Sources.

`asset.source.accepted` events share each Creating application's protected results channel with command results. Consumers distinguish event types and correlate Asset/candidate identities with durable intent. Confirmations retry with stable occurrence identity and a finite leased outbox budget. Only the operator's `recover-source-confirmation` command retries exhausted work; status reads do not reset the budget.

## Terminal owned-Asset deletion

Only the protected Creating-application command channel authorizes full deletion. The [lifecycle port](src/capabilities/lifecycle/contract.ts) atomically records the result, terminal fence, empty-capability responsibility and cleanup obligation. Acceptance disables new Source operations and original reads while evidence may remain private. Previously accepted reads retain their finite protection.

Create replay returns the original result without restoring the Asset. Equal delete replay returns its recorded result; a fresh delete command returns `already-deleted`. Compact Asset and command fences survive evidence expiry. Candidate identities and immutable Source metadata identify cleanup independently of active membership. Public deletion/discovery announcements remain a future contract.

New development authority files permit creation and deletion for initial applications. Existing files retain their permissions; enable deletion explicitly and activate the file before restart. Every lifecycle acceptance, including replay, compares the active configuration under its transaction lock, fencing obsolete workers. Credential rotation preserves application identity; removing a permission does not rewrite recorded outcomes.

## Private byte reclamation

The [cleanup capability](src/capabilities/cleanup/index.ts) reclaims expired evidence and abandoned or terminal candidate data through bounded durable work. Deadlines survive retries, configuration changes and restart. Accepted or cancelled inputs become reclaimable promptly; retired Source evidence retains its recorded deadline. The membership lock also excludes current Sources from reclamation.

Original-read authorization atomically reserves finite protection. Its absolute deadline covers database authorization, storage opening and streaming; EOF, cancellation and failure release it. Expiry grants no serving authority. The [authority parser](src/authority.ts) defines `sourceOperations.readLifetimeMs` and `reclamationTimeoutMs` independently of retention and Color Extractor execution. These operational ceilings do not qualify production throughput or native processing capacity.

The [storage adapter](src/adapters/sources/storage.ts) atomically replaces reclaimed payloads with empty deletion markers at their exact private identities. Markers prevent late conditional writes from recreating bytes, a race that deleting the object would permit. Retain markers for the installation's replay lifetime and exclude them from bucket lifecycle removal. Real storage contracts qualify the repository's SeaweedFS version, including a conditional write already consuming its body and an ambiguous reclamation response. Other storage implementations require the same qualification.

Once terminal cleanup completes, image metadata and candidate history are purged; compact Asset, command and cleanup fences remain. Exhausted cleanup is quarantined and sent to the operator inbox with subject `asset.cleanup.<responsibility ID>`. Pass that ID to [`recover-cleanup`](scripts/operator.ts). Recovery preserves the deadline and creates a new notice occurrence if work exhausts again; retries preserve each occurrence's identity. Owner HTTP routes grant neither recovery nor full deletion authority.
