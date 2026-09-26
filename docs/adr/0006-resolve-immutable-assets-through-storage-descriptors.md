# Resolve immutable assets through storage descriptors

Status: accepted

## Context

Upload, generated-variant, and Profile-picture events exposed S3 bucket names and object keys. The distributed-interaction guidelines require logical asset references. Deriving addresses from the current configuration would break assets retained under earlier bucket names or paths.

## Decision

An asset reference contains its owning producer and an immutable ID. Producers register a descriptor in the private `ASSET_REFERENCE_BUCKET`, which defaults to `asset-references`. Its key is the owner followed by the URI-encoded ID and `.json`. The descriptor records the reference and the exact bucket and key of the immutable object.

The descriptor bucket and S3 endpoint are stable deployment configuration for the retained asset lifetime. Moving that store requires copying its descriptors before changing consumer configuration. Changing the ordinary object bucket does not rewrite registered descriptors.

Registration uses conditional creation. A retry adopts an existing descriptor only when its reference and location agree. A conflicting mapping fails and cannot overwrite the first writer. The producer completes registration before publishing an event that refers to it. A failed or ambiguous registration remains retryable through the producer's existing outbox or unacknowledged delivery. No transaction spans PostgreSQL, S3, and NATS.

Only storage adapters read descriptors. They validate the descriptor identity and bound its size before using its recorded address. This is direct consumption of producer-owned immutable storage, as permitted by the backend ownership guidelines. Applications continue to own their mutable persistence and local models.

Current upload events carry `wallpaper.asset`. Generated-variant events carry `variant.asset`. Picture announcements carry `change.asset.reference` alongside public image metadata. Upload events no longer carry the client filename, which downstream consumers do not need.

## Retained history and lifecycle

Consumers continue to parse historical coordinate-based events. Those messages retain their original bytes and envelope in streams and quarantine; their exact recorded addresses remain valid. Current outbox publication may translate its private recorded address into a registered logical reference, preserving occurrence identity and public facts. No stream, quarantine, outbox, or projection is purged for this migration.

Descriptors contain no credentials or image bytes and have no anonymous access. Production credentials should allow each producer to create only its own descriptor prefix and each consumer to read only the owners it consumes. Only the owning producer may delete descriptors or object bytes. Keep descriptors for at least the complete event replay and asset retention horizon; never reassign an ID after retirement. Profile-picture availability checks still gate delivery, so retaining a descriptor does not make a retired picture publicly available.

Ingestor historically derives original addresses from its configured asset bucket. Descriptor registration now detects attempts to reassign an already published original when that configuration changes. Relocating existing originals requires an explicit storage migration; changing configuration alone must not silently redirect the identity.

## Verification

Real S3 contract tests cover registration retries and conflicting mappings. Producer tests confirm the descriptor exists before the broker accepts the announcement. Consumer tests resolve logical references and replay historical events. The infrastructure smoke test verifies private descriptor access and persistence across a storage restart.
