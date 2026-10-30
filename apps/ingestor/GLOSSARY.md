# Wallpaper ingestion

Ingestion currently accepts authenticated wallpaper bytes and owns progress through broker acknowledgement. The [accepted target](../../docs/adr/0012-own-stable-assets-and-immutable-sources-in-media.md) transfers byte acceptance, storage and lifecycle to Asset; Ingestion retains Wallpaper identity and workflow. The current terms and policy below describe the implementation being replaced.

## Accepted target language

**Wallpaper**:
A contribution identified independently of its associated Asset. This context owns its existence, publication and contributor facts, while the Asset service owns its immutable Sources and delivery capabilities.

**Wallpaper Asset reference**:
The confirmed Asset ID associated with a Wallpaper, distinct from the Wallpaper ID. The Wallpaper ID can be supplied as an opaque Application reference during the Asset service creation without becoming the Asset identity.

## Language

- **Upload**: one Profile's attempt to introduce wallpaper content. Identical content for the same Profile resolves to the existing active upload; another Profile may upload the same bytes.
- **Inspected content**: bytes whose detected format, size, and dimensions satisfy the ingestion policy. Currently JPEG, PNG, and WebP images are supported.
- **Upload reservation**: persisted identity, owner, complete inspected metadata, logical asset reference, and announcement occurrence before object storage begins.
- **Stored upload**: an upload whose immutable original asset exists and whose announcement is durably recorded in the outbox.
- **Upload announcement**: the committed fact that a wallpaper original is available for downstream processing. Repeated delivery preserves the occurrence's source and ID.
- **Processing upload**: the broker has durably acknowledged its upload announcement. Ingestion does not claim that downstream enrichment has finished.
- **Recovery lease**: expiring ownership of one incomplete upload's recovery work. It prevents ordinary concurrent recovery while allowing another replica to resume after a crash.
- **Quarantined announcement**: a stored upload whose finite publication attempts are exhausted. Its outbox occurrence remains available for operational investigation and deliberate replay.

## Relationships

Ingestion publishes wallpaper upload announcements for independent enrichment and catalogue consumers. It uses the Profile ID as an ownership fact without synchronously hydrating another context. Immutable original assets use a logical wallpaper ID and extension inside the capability; storage adapters own bucket and object-key translation.

## Policy

Inspection permits still JPEG, PNG, and WebP images up to 50 MiB (52,428,800 encoded bytes), 100,000,000 total pixels, and 20,000 pixels on either axis. The limits are inclusive. There is no minimum dimension beyond a valid positive image size. These limits do not guarantee every downstream variant or color extraction. Animated PNG and WebP are rejected because animated wallpaper processing is undefined. Content determines format; the supplied MIME type is diagnostic input. Anonymous ingestion is rejected. Recovery checks the exact persisted asset reference, retries missing originals finitely, and publishes only after stored state and an outbox entry commit together.
